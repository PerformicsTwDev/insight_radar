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

interface Harness {
  processor: KeywordAnalysisProcessor;
  expand: jest.Mock;
  fetchHistorical: jest.Mock;
  labelKeywords: jest.Mock;
}

function buildHarness(): Harness {
  const expand = jest.fn().mockResolvedValue([keyword('running shoes'), keyword('trail shoes')]);
  const fetchHistorical = jest
    .fn()
    .mockResolvedValue([keyword('running shoes', { source: 'seed' })]);
  const labelKeywords = jest.fn().mockResolvedValue({
    labeled: [
      { keyword: 'running shoes', labels: ['commercial'] },
      { keyword: 'trail shoes', labels: ['informational'] },
    ],
    needsReview: [],
  });

  const ads = { expand, fetchHistoricalMetrics: fetchHistorical } as unknown as GoogleAdsService;
  const intent = { labelKeywords } as unknown as IntentService;
  const processor = new KeywordAnalysisProcessor(ads, intent);

  return { processor, expand, fetchHistorical, labelKeywords };
}

describe('KeywordAnalysisProcessor (T3.5, TC-11/TC-35)', () => {
  it('runs fetch → metrics → intent in order and reports progress ending at 100 (TC-11)', async () => {
    const { processor, expand, labelKeywords } = buildHarness();
    const job = fakeJob(buildPayload());

    const result = await processor.process(job as never);

    // fetch happened before labeling
    expect(expand).toHaveBeenCalledTimes(1);
    expect(labelKeywords).toHaveBeenCalledTimes(1);
    const expandOrder = expand.mock.invocationCallOrder[0];
    const labelOrder = labelKeywords.mock.invocationCallOrder[0];
    expect(expandOrder).toBeLessThan(labelOrder);

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

  it('routes mode=expand to GoogleAdsService.expand only (TC-35)', async () => {
    const { processor, expand, fetchHistorical } = buildHarness();

    await processor.process(
      fakeJob(
        buildPayload({ params: { geo: 'g', language: 'l', mode: 'expand', includeAdult: false } }),
      ) as never,
    );

    expect(expand).toHaveBeenCalledTimes(1);
    expect(fetchHistorical).not.toHaveBeenCalled();
  });

  it('routes mode=exact to GoogleAdsService.fetchHistoricalMetrics only (TC-35)', async () => {
    const { processor, expand, fetchHistorical } = buildHarness();

    await processor.process(
      fakeJob(
        buildPayload({ params: { geo: 'g', language: 'l', mode: 'exact', includeAdult: false } }),
      ) as never,
    );

    expect(fetchHistorical).toHaveBeenCalledTimes(1);
    expect(expand).not.toHaveBeenCalled();
  });

  it('passes seeds + params through to the fetch method', async () => {
    const { processor, expand } = buildHarness();
    const payload = buildPayload();

    await processor.process(fakeJob(payload) as never);

    expect(expand).toHaveBeenCalledWith(
      payload.seeds,
      expect.objectContaining({ geo: payload.params.geo }),
    );
  });

  it('labels the fetched keywords by normalizedText', async () => {
    const { processor, labelKeywords } = buildHarness();

    await processor.process(fakeJob(buildPayload()) as never);

    expect(labelKeywords).toHaveBeenCalledWith(['running shoes', 'trail shoes']);
  });

  it('logs (does not throw) on the failed worker event', () => {
    const { processor } = buildHarness();
    const job = fakeJob(buildPayload());

    expect(() => processor.onFailed(job as never, new Error('boom'))).not.toThrow();
  });
});
