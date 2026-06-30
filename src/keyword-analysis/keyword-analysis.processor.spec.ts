import { GoogleAdsService } from '../google-ads/google-ads.service';
import type { Keyword } from '../google-ads/keyword.types';
import { IntentService } from '../intent/intent.service';
import { KeywordAnalysisProcessor } from './keyword-analysis.processor';
import type { AnalysisJobPayload } from './keyword-analysis.service';

function keyword(text: string, overrides: Partial<Keyword> = {}): Keyword {
  return {
    text,
    normalizedText: text.toLowerCase(),
    source: 'expanded',
    geo: 'geoTargetConstants/2158',
    language: 'languageConstants/1018',
    avgMonthlySearches: 100,
    competition: 'LOW',
    competitionIndex: 10,
    cpcLow: null,
    cpcHigh: null,
    cpcLowMicros: null,
    cpcHighMicros: null,
    currencyCode: 'TWD',
    monthlyVolumes: [],
    ...overrides,
  };
}

interface FakeJob {
  id: string;
  data: AnalysisJobPayload;
  updateProgress: jest.Mock;
}

function fakeJob(payload: AnalysisJobPayload): FakeJob {
  return { id: payload.analysisId, data: payload, updateProgress: jest.fn() };
}

function buildPayload(overrides: Partial<AnalysisJobPayload> = {}): AnalysisJobPayload {
  return {
    analysisId: 'a-1',
    seeds: ['Running Shoes', 'trail shoes'],
    params: {
      geo: 'geoTargetConstants/2158',
      language: 'languageConstants/1018',
      mode: 'expand',
      includeAdult: false,
    },
    ...overrides,
  };
}

/** 把多批關鍵字包成 generator（模擬 expandStream 逐批產出；`for await` 接受 sync iterable）。 */
function* gen(batches: Keyword[][]): Generator<Keyword[]> {
  for (const batch of batches) {
    yield batch;
  }
}

interface Harness {
  processor: KeywordAnalysisProcessor;
  expandStream: jest.Mock;
  fetchHistorical: jest.Mock;
  labelStream: jest.Mock;
  labeledTexts: string[];
}

function buildHarness(): Harness {
  const expandStream = jest.fn(() => gen([[keyword('running shoes'), keyword('trail shoes')]]));
  const fetchHistorical = jest
    .fn()
    .mockResolvedValue([keyword('running shoes', { source: 'seed' })]);
  const labeledTexts: string[] = [];
  // Matches IntentService.labelStream: drains the text batches, returns LabelResult.
  const labelStream = jest.fn(async (batches: AsyncIterable<string[]>) => {
    for await (const batch of batches) {
      labeledTexts.push(...batch);
    }
    return {
      labeled: labeledTexts.map((t) => ({ keyword: t, labels: ['informational'] })),
      needsReview: [],
    };
  });

  const ads = {
    expandStream,
    fetchHistoricalMetrics: fetchHistorical,
  } as unknown as GoogleAdsService;
  const intent = { labelStream } as unknown as IntentService;
  const processor = new KeywordAnalysisProcessor(ads, intent);

  return { processor, expandStream, fetchHistorical, labelStream, labeledTexts };
}

describe('KeywordAnalysisProcessor (T3.5/T3.7, TC-11/TC-35/TC-33)', () => {
  it('runs fetch → metrics → intent in order and reports progress ending at 100 (TC-11)', async () => {
    const { processor, expandStream, labelStream } = buildHarness();
    const job = fakeJob(buildPayload());

    const result = await processor.process(job as never);

    // expansion stream created before labeling consumes it
    expect(expandStream).toHaveBeenCalledTimes(1);
    expect(labelStream).toHaveBeenCalledTimes(1);
    expect(expandStream.mock.invocationCallOrder[0]).toBeLessThan(
      labelStream.mock.invocationCallOrder[0],
    );

    // progress reported through phases, terminating at percent:100
    const progressCalls = job.updateProgress.mock.calls as Array<
      [{ phase: string; percent: number }]
    >;
    const phases = progressCalls.map(([p]) => p.phase);
    expect(phases).toEqual(['fetch', 'metrics', 'intent']);
    expect(progressCalls.at(-1)?.[0].percent).toBe(100);

    // returns a count of the assembled keywords
    expect(result).toEqual({ count: 2 });
  });

  it('overlaps labeling with expansion — A/B pipeline (TC-33)', async () => {
    const events: string[] = [];
    let releaseBatch2!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseBatch2 = resolve;
    });
    async function* twoBatches(): AsyncGenerator<Keyword[]> {
      events.push('expand:batch1');
      yield [keyword('a')];
      await gate; // 第二批拓展等待釋放
      events.push('expand:batch2');
      yield [keyword('b')];
    }
    const expandStream = jest.fn(() => twoBatches());
    const labelStream = jest.fn(async (batches: AsyncIterable<string[]>) => {
      for await (const batch of batches) {
        events.push(`label:${batch.join(',')}`);
        if (batch.includes('a')) {
          releaseBatch2(); // 收到第一批即釋放第二批拓展
        }
      }
      return { labeled: [], needsReview: [] };
    });
    const ads = {
      expandStream,
      fetchHistoricalMetrics: jest.fn(),
    } as unknown as GoogleAdsService;
    const intent = { labelStream } as unknown as IntentService;
    const processor = new KeywordAnalysisProcessor(ads, intent);

    await processor.process(fakeJob(buildPayload()) as never);

    // 第一批貼標發生在第二批拓展之前 → 階段重疊（非「全拓展完才貼標」）。
    expect(events.indexOf('label:a')).toBeLessThan(events.indexOf('expand:batch2'));
  });

  it('routes mode=expand to GoogleAdsService.expandStream only (TC-35)', async () => {
    const { processor, expandStream, fetchHistorical } = buildHarness();

    await processor.process(
      fakeJob(
        buildPayload({ params: { geo: 'g', language: 'l', mode: 'expand', includeAdult: false } }),
      ) as never,
    );

    expect(expandStream).toHaveBeenCalledTimes(1);
    expect(fetchHistorical).not.toHaveBeenCalled();
  });

  it('routes mode=exact to GoogleAdsService.fetchHistoricalMetrics only (TC-35)', async () => {
    const { processor, expandStream, fetchHistorical } = buildHarness();

    await processor.process(
      fakeJob(
        buildPayload({ params: { geo: 'g', language: 'l', mode: 'exact', includeAdult: false } }),
      ) as never,
    );

    expect(fetchHistorical).toHaveBeenCalledTimes(1);
    expect(expandStream).not.toHaveBeenCalled();
  });

  it('passes seeds + params through to the fetch source', async () => {
    const { processor, expandStream } = buildHarness();
    const payload = buildPayload();

    await processor.process(fakeJob(payload) as never);

    expect(expandStream).toHaveBeenCalledWith(
      payload.seeds,
      expect.objectContaining({ geo: payload.params.geo }),
    );
  });

  it('feeds the fetched keywords to labeling by normalizedText', async () => {
    const { processor, labeledTexts } = buildHarness();

    await processor.process(fakeJob(buildPayload()) as never);

    expect(labeledTexts).toEqual(['running shoes', 'trail shoes']);
  });

  it('logs (does not throw) on the failed worker event', () => {
    const { processor } = buildHarness();
    const job = fakeJob(buildPayload());

    expect(() => processor.onFailed(job as never, new Error('boom'))).not.toThrow();
  });

  it('throws a clear error for an unknown mode (malformed payload, no TypeError loop)', async () => {
    const { processor, expandStream, fetchHistorical } = buildHarness();
    const payload = buildPayload({
      params: { geo: 'g', language: 'l', mode: 'bogus' as never, includeAdult: false },
    });

    await expect(processor.process(fakeJob(payload) as never)).rejects.toThrow(
      /Unknown analysis mode: bogus/,
    );
    expect(expandStream).not.toHaveBeenCalled();
    expect(fetchHistorical).not.toHaveBeenCalled();
  });
});
