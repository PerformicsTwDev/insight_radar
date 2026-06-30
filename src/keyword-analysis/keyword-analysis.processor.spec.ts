import { GoogleAdsService } from '../google-ads/google-ads.service';
import type { Keyword, KeywordCandidate } from '../google-ads/keyword.types';
import { IntentService } from '../intent/intent.service';
import { PrismaService } from '../prisma';
import { KeywordAnalysisProcessor } from './keyword-analysis.processor';
import { ResultSnapshotService } from './result-snapshot.service';
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

function candidate(text: string): KeywordCandidate {
  return { text, source: 'expanded' };
}

/** 把多批候選包成 generator（模擬 expandStreamRaw 逐批產出；`for await` 接受 sync iterable）。 */
function* candGen(batches: KeywordCandidate[][]): Generator<KeywordCandidate[]> {
  for (const batch of batches) {
    yield batch;
  }
}

interface SavedRow {
  normalizedText: string;
  intent: string[];
}
interface Harness {
  processor: KeywordAnalysisProcessor;
  expandStreamRaw: jest.Mock;
  mergeExpansion: jest.Mock;
  fetchHistorical: jest.Mock;
  labelStream: jest.Mock;
  saveResult: jest.Mock;
  prismaUpdateMany: jest.Mock;
  labeledTexts: string[];
}

function buildHarness(): Harness {
  // 候選 text 為混合大小寫（'Running Shoes'）→ normalizeText 'running shoes'：驗證合併以 normalizedText 為 key。
  const expandStreamRaw = jest.fn(() =>
    candGen([[candidate('Running Shoes'), candidate('trail shoes')]]),
  );
  // mergeExpansion 回權威 Keyword[]（normalizedText = lowercase）。
  const mergeExpansion = jest.fn(() => [keyword('Running Shoes'), keyword('trail shoes')]);
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
  // Matches ResultSnapshotService.saveResult: count = rows.length, returns the snapshot id.
  const saveResult = jest.fn((_analysisId: string, rows: SavedRow[]) =>
    Promise.resolve({ resultSnapshotId: 'snap-1', count: rows.length, checksum: 'sum' }),
  );

  const prismaUpdateMany = jest.fn().mockResolvedValue({ count: 1 });

  const ads = {
    expandStreamRaw,
    mergeExpansion,
    fetchHistoricalMetrics: fetchHistorical,
  } as unknown as GoogleAdsService;
  const intent = { labelStream } as unknown as IntentService;
  const snapshots = { saveResult } as unknown as ResultSnapshotService;
  const prisma = {
    keywordAnalysis: { updateMany: prismaUpdateMany },
  } as unknown as PrismaService;
  const processor = new KeywordAnalysisProcessor(ads, intent, snapshots, prisma);

  return {
    processor,
    expandStreamRaw,
    mergeExpansion,
    fetchHistorical,
    labelStream,
    saveResult,
    prismaUpdateMany,
    labeledTexts,
  };
}

describe('KeywordAnalysisProcessor (T3.5/T3.7, TC-11/TC-35/TC-33)', () => {
  it('runs fetch → metrics → intent in order and reports progress ending at 100 (TC-11)', async () => {
    const { processor, expandStreamRaw, labelStream } = buildHarness();
    const job = fakeJob(buildPayload());

    const result = await processor.process(job as never);

    // expansion + labeling both run (labelStream drives the raw stream lazily → overlap; see TC-33)
    expect(expandStreamRaw).toHaveBeenCalledTimes(1);
    expect(labelStream).toHaveBeenCalledTimes(1);

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
    async function* twoBatches(): AsyncGenerator<KeywordCandidate[]> {
      events.push('expand:batch1');
      yield [candidate('a')];
      await gate; // 第二批拓展等待釋放
      events.push('expand:batch2');
      yield [candidate('b')];
    }
    const expandStreamRaw = jest.fn(() => twoBatches());
    const mergeExpansion = jest.fn(() => []);
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
      expandStreamRaw,
      mergeExpansion,
      fetchHistoricalMetrics: jest.fn(),
    } as unknown as GoogleAdsService;
    const intent = { labelStream } as unknown as IntentService;
    const snapshots = {
      saveResult: jest.fn().mockResolvedValue({ resultSnapshotId: 's', count: 2, checksum: 'x' }),
    } as unknown as ResultSnapshotService;
    const prisma = {
      keywordAnalysis: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as PrismaService;
    const processor = new KeywordAnalysisProcessor(ads, intent, snapshots, prisma);

    await processor.process(fakeJob(buildPayload()) as never);

    // 第一批貼標發生在第二批拓展之前 → 階段重疊（非「全拓展完才貼標」）。
    expect(events.indexOf('label:a')).toBeLessThan(events.indexOf('expand:batch2'));
  });

  it('routes mode=expand to GoogleAdsService.expandStreamRaw only (TC-35)', async () => {
    const { processor, expandStreamRaw, fetchHistorical } = buildHarness();

    await processor.process(
      fakeJob(
        buildPayload({ params: { geo: 'g', language: 'l', mode: 'expand', includeAdult: false } }),
      ) as never,
    );

    expect(expandStreamRaw).toHaveBeenCalledTimes(1);
    expect(fetchHistorical).not.toHaveBeenCalled();
  });

  it('routes mode=exact to GoogleAdsService.fetchHistoricalMetrics only (TC-35)', async () => {
    const { processor, expandStreamRaw, fetchHistorical } = buildHarness();

    await processor.process(
      fakeJob(
        buildPayload({ params: { geo: 'g', language: 'l', mode: 'exact', includeAdult: false } }),
      ) as never,
    );

    expect(fetchHistorical).toHaveBeenCalledTimes(1);
    expect(expandStreamRaw).not.toHaveBeenCalled();
  });

  it('passes seeds + params through to the fetch source', async () => {
    const { processor, expandStreamRaw } = buildHarness();
    const payload = buildPayload();

    await processor.process(fakeJob(payload) as never);

    expect(expandStreamRaw).toHaveBeenCalledWith(
      payload.seeds,
      expect.objectContaining({ geo: payload.params.geo }),
    );
  });

  it('feeds the fetched keywords to labeling by normalizedText', async () => {
    const { processor, labeledTexts } = buildHarness();

    await processor.process(fakeJob(buildPayload()) as never);

    expect(labeledTexts).toEqual(['running shoes', 'trail shoes']);
  });

  it('persists a snapshot with keywords merged with their intent labels (T3.10)', async () => {
    const { processor, saveResult } = buildHarness();

    await processor.process(fakeJob(buildPayload()) as never);

    expect(saveResult).toHaveBeenCalledTimes(1);
    const [analysisId, rows] = saveResult.mock.calls[0] as [string, SavedRow[]];
    expect(analysisId).toBe('a-1');
    expect(rows).toEqual([
      expect.objectContaining({ normalizedText: 'running shoes', intent: ['informational'] }),
      expect.objectContaining({ normalizedText: 'trail shoes', intent: ['informational'] }),
    ]);
  });

  it('logs and persists without throwing on the failed worker event', async () => {
    const { processor } = buildHarness();
    const job = fakeJob(buildPayload());

    await expect(processor.onFailed(job as never, new Error('boom'))).resolves.toBeUndefined();
  });

  describe('advances the DB state machine (M3-R1)', () => {
    interface UpdateManyArg {
      where: { id: string; status?: { notIn: string[] } };
      data: { status?: string; error?: string; progress?: { phase: string; percent: number } };
    }
    const argsOf = (mock: jest.Mock): UpdateManyArg[] =>
      (mock.mock.calls as unknown[][]).map((call) => call[0] as UpdateManyArg);

    it('marks running + startedAt at job start (conditional, not overwriting terminal)', async () => {
      const { processor, prismaUpdateMany } = buildHarness();
      await processor.process(fakeJob(buildPayload()) as never);

      const running = argsOf(prismaUpdateMany).find((a) => a.data.status === 'running');
      expect(running).toBeDefined();
      expect(running?.where.id).toBe('a-1');
      expect(running?.where.status?.notIn).toEqual(
        expect.arrayContaining(['completed', 'failed', 'canceled']),
      );
    });

    it('mirrors progress to the DB (poll source of truth), ending at intent/100', async () => {
      const { processor, prismaUpdateMany } = buildHarness();
      await processor.process(fakeJob(buildPayload()) as never);

      const progress = argsOf(prismaUpdateMany)
        .map((a) => a.data.progress)
        .filter((p): p is { phase: string; percent: number } => p !== undefined);
      expect(progress.length).toBeGreaterThan(0);
      expect(progress.at(-1)).toMatchObject({ phase: 'intent', percent: 100 });
    });

    it('persists status=failed + error on the failed worker event (FR-8 poll)', async () => {
      const { processor, prismaUpdateMany } = buildHarness();
      prismaUpdateMany.mockClear();

      await processor.onFailed(fakeJob(buildPayload()) as never, new Error('boom'));

      const failed = argsOf(prismaUpdateMany).find((a) => a.data.status === 'failed');
      expect(failed?.data.error).toBe('boom');
      expect(failed?.where.status?.notIn).toEqual(
        expect.arrayContaining(['completed', 'failed', 'canceled']),
      );
    });

    it('skips the failed-status write when the job has no analysisId', async () => {
      const { processor, prismaUpdateMany } = buildHarness();
      prismaUpdateMany.mockClear();
      await processor.onFailed({ id: 'x', data: {} } as never, new Error('boom'));
      expect(prismaUpdateMany).not.toHaveBeenCalled();
    });

    it('swallows a persist error on the failed event (logs, never re-throws into the worker)', async () => {
      const { processor, prismaUpdateMany } = buildHarness();
      prismaUpdateMany.mockRejectedValueOnce(new Error('db down'));

      // onFailed 自身不得拋——再拋會讓 worker 的 failed 事件處理崩潰（吞錯只記 log）。
      await expect(
        processor.onFailed(fakeJob(buildPayload()) as never, new Error('boom')),
      ).resolves.toBeUndefined();
    });
  });

  it('throws a clear error for an unknown mode (malformed payload, no TypeError loop)', async () => {
    const { processor, expandStreamRaw, fetchHistorical } = buildHarness();
    const payload = buildPayload({
      params: { geo: 'g', language: 'l', mode: 'bogus' as never, includeAdult: false },
    });

    await expect(processor.process(fakeJob(payload) as never)).rejects.toThrow(
      /Unknown analysis mode: bogus/,
    );
    expect(expandStreamRaw).not.toHaveBeenCalled();
    expect(fetchHistorical).not.toHaveBeenCalled();
  });
});
