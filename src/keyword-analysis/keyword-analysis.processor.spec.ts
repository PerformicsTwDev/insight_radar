import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';
import { GoogleAdsService } from '../google-ads/google-ads.service';
import type { Keyword, KeywordCandidate } from '../google-ads/keyword.types';
import { MetricsCache } from '../google-ads/metrics-cache';
import { IntentService } from '../intent/intent.service';
import { PrismaService } from '../prisma';
import { queueConfig } from '../config/queue.config';
import { KeywordAnalysisProcessor } from './keyword-analysis.processor';
import { ResultSnapshotService } from './result-snapshot.service';
import type { AnalysisJobPayload } from './keyword-analysis.service';

/** worker concurrency 測試值（刻意非 BullMQ 預設 1，驗證 config 確被接上）。 */
const WORKER_CONCURRENCY = 5;
const queueCfg = { workerConcurrency: WORKER_CONCURRENCY } as unknown as ConfigType<
  typeof queueConfig
>;

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
  /** BullMQ 在「最終態失敗」才設 finishedOn（重試中間態為 undefined）。 */
  finishedOn?: number;
  attemptsMade?: number;
  opts?: { attempts?: number };
}

function fakeJob(payload: AnalysisJobPayload): FakeJob {
  return { id: payload.analysisId, data: payload, updateProgress: jest.fn() };
}

/** 最終態失敗 job（重試耗盡）：finishedOn 已設 + attemptsMade==attempts → onFailed 應寫 DB failed。 */
function terminalFailedJob(payload: AnalysisJobPayload = buildPayload()): FakeJob {
  return {
    ...fakeJob(payload),
    finishedOn: 1_700_000_000_000,
    attemptsMade: 5,
    opts: { attempts: 5 },
  };
}

/** 重試中間態失敗 job（還會再試）：finishedOn 未設 + attemptsMade<attempts → onFailed 應跳過、不寫終態。 */
function retryableFailedJob(payload: AnalysisJobPayload = buildPayload()): FakeJob {
  return { ...fakeJob(payload), finishedOn: undefined, attemptsMade: 1, opts: { attempts: 5 } };
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

/** expandStreamRaw 呼叫即拋 → 處理器 `for await (… of ads.expandStreamRaw(…))` 的 evaluand 拋 → 傳到 process() catch（無累積候選）。 */
function throwing(err: unknown): jest.Mock {
  return jest.fn(() => {
    throw err;
  });
}

/** 產一批候選後拋（模擬串流中途失敗但已累積部分候選）。 */
function* oneBatchThenThrow(err: unknown): Generator<KeywordCandidate[]> {
  yield [candidate('kept keyword')];
  throw err;
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
  monthlyVolumes: unknown[];
}
interface Harness {
  processor: KeywordAnalysisProcessor;
  expandStreamRaw: jest.Mock;
  mergeExpansion: jest.Mock;
  fetchHistorical: jest.Mock;
  labelStream: jest.Mock;
  saveResult: jest.Mock;
  prismaUpdateMany: jest.Mock;
  metricsMget: jest.Mock;
  metricsMset: jest.Mock;
  metricsMsetByText: jest.Mock;
  metricsLog: { info: jest.Mock };
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

  // 預設全 miss（mget 對齊輸入長度回 undefined），mset no-op：exact 模式落回打 Ads（既有測試行為不變）。
  const metricsMget = jest.fn((nts: string[]) => Promise.resolve(nts.map(() => undefined)));
  const metricsMset = jest.fn().mockResolvedValue(undefined);
  const metricsMsetByText = jest.fn().mockResolvedValue(undefined);

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
  const metricsCache = {
    mget: metricsMget,
    mset: metricsMset,
    msetByText: metricsMsetByText,
  } as unknown as MetricsCache;
  const metricsLog = { info: jest.fn() };
  const processor = new KeywordAnalysisProcessor(
    ads,
    intent,
    snapshots,
    prisma,
    metricsCache,
    queueCfg,
    metricsLog as unknown as ConstructorParameters<typeof KeywordAnalysisProcessor>[6],
  );

  return {
    processor,
    expandStreamRaw,
    mergeExpansion,
    fetchHistorical,
    labelStream,
    saveResult,
    prismaUpdateMany,
    metricsMget,
    metricsMset,
    metricsMsetByText,
    metricsLog,
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
    const metricsCache = {
      mget: jest.fn((nts: string[]) => Promise.resolve(nts.map(() => undefined))),
      mset: jest.fn().mockResolvedValue(undefined),
      msetByText: jest.fn().mockResolvedValue(undefined),
    } as unknown as MetricsCache;
    const processor = new KeywordAnalysisProcessor(
      ads,
      intent,
      snapshots,
      prisma,
      metricsCache,
      queueCfg,
      { info: jest.fn() } as unknown as ConstructorParameters<typeof KeywordAnalysisProcessor>[6],
    );

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

  it('writes expand-mode metrics back keyed by own normalizedText, not by seedOrigins (no seed poisoning, T4.4)', async () => {
    const { processor, mergeExpansion, metricsMset, metricsMsetByText } = buildHarness();
    // 真實拓展字帶 seedOrigins=[parent seed]；若用 mset（seedOrigins 當 key）會把拓展字寫到 seed 的 key、
    // 污染 seed 指標。回寫須走 msetByText（各字自身 nt 為 key）。
    const expansion = keyword('trail running shoes', {
      source: 'expanded',
      seedOrigins: ['running shoes'],
    });
    const seed = keyword('running shoes', { source: 'seed' });
    mergeExpansion.mockReturnValueOnce([expansion, seed]);

    await processor.process(fakeJob(buildPayload()) as never);

    expect(metricsMsetByText).toHaveBeenCalledWith(
      [expansion, seed],
      expect.objectContaining({ geo: 'geoTargetConstants/2158' }),
    );
    // **不**走 mset（避免拓展字被寫到 seedOrigins=parent seed 的 key）。
    expect(metricsMset).not.toHaveBeenCalled();
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

  describe('exact-mode metrics cache-first (T4.1, TC-20 部分)', () => {
    const exactPayload = buildPayload({
      seeds: ['Running Shoes', 'trail shoes'],
      params: { geo: 'g', language: 'l', mode: 'exact', includeAdult: false },
    });

    it('skips Ads when every keyword hits the metrics cache (命中省 Ads 呼叫)', async () => {
      const { processor, fetchHistorical, metricsMget } = buildHarness();
      // 全命中（mget 對齊輸入回完整 Keyword）→ 不打 fetchHistoricalMetrics。
      metricsMget.mockResolvedValueOnce([
        keyword('running shoes', { source: 'seed' }),
        keyword('trail shoes', { source: 'seed' }),
      ]);

      const result = await processor.process(fakeJob(exactPayload) as never);

      expect(fetchHistorical).not.toHaveBeenCalled();
      expect(result).toEqual({ count: 2 });
    });

    it('looks up the cache by normalizedText (去重 key 與快取 key 共用)', async () => {
      const { processor, metricsMget } = buildHarness();
      metricsMget.mockResolvedValueOnce([
        keyword('running shoes', { source: 'seed' }),
        keyword('trail shoes', { source: 'seed' }),
      ]);

      await processor.process(fakeJob(exactPayload) as never);

      // 原字 'Running Shoes'/'trail shoes' → normalizeText → 'running shoes'/'trail shoes'。
      expect(metricsMget).toHaveBeenCalledWith(
        ['running shoes', 'trail shoes'],
        expect.objectContaining({ geo: 'g', language: 'l' }),
      );
    });

    it('fetches only cache-miss keywords from Ads and writes them back', async () => {
      const { processor, fetchHistorical, metricsMget, metricsMset } = buildHarness();
      // 第一筆命中、第二筆 miss → 只對 miss 打 Ads。
      metricsMget.mockResolvedValueOnce([keyword('running shoes', { source: 'seed' }), undefined]);
      fetchHistorical.mockResolvedValueOnce([keyword('trail shoes', { source: 'seed' })]);

      const result = await processor.process(fakeJob(exactPayload) as never);

      expect(fetchHistorical).toHaveBeenCalledTimes(1);
      expect(fetchHistorical).toHaveBeenCalledWith(['trail shoes'], expect.anything());
      // 回寫新取得者（之後可命中）。
      expect(metricsMset).toHaveBeenCalledWith(
        [expect.objectContaining({ normalizedText: 'trail shoes' })],
        expect.anything(),
      );
      expect(result).toEqual({ count: 2 }); // 命中 + 新取合併
    });

    it('dedupes by normalizedText so a warm cache does not drift the count (duplicate-normalizing seeds)', async () => {
      const { processor, fetchHistorical, metricsMget } = buildHarness();
      const payload = buildPayload({
        seeds: ['Running Shoes', 'running shoes'], // 兩者 normalize 為同一字
        params: { geo: 'g', language: 'l', mode: 'exact', includeAdult: false },
      });
      // mget 對齊輸入 → 同一命中回兩次。
      metricsMget.mockResolvedValueOnce([
        keyword('running shoes', { source: 'seed' }),
        keyword('running shoes', { source: 'seed' }),
      ]);

      const result = await processor.process(fakeJob(payload) as never);

      expect(fetchHistorical).not.toHaveBeenCalled();
      // cold 路徑（fetchHistoricalMetrics dedupeMerge）會是 1 列 → 命中不得改變正確性（AC-10.5）。
      expect(result).toEqual({ count: 1 });
    });

    it('dedupes a cache hit that collides with a freshly-fetched canonical keyword', async () => {
      const { processor, metricsMget, fetchHistorical } = buildHarness();
      const payload = buildPayload({
        seeds: ['cars', 'car'],
        params: { geo: 'g', language: 'l', mode: 'exact', includeAdult: false },
      });
      // 'cars' 命中（canonical），'car' miss → 打 Ads 回同一 canonical 'cars'（涵蓋 'car'）。
      metricsMget.mockResolvedValueOnce([keyword('cars', { source: 'seed' }), undefined]);
      fetchHistorical.mockResolvedValueOnce([
        keyword('cars', { source: 'seed', seedOrigins: ['car'] }),
      ]);

      const result = await processor.process(fakeJob(payload) as never);

      expect(result).toEqual({ count: 1 }); // hit 'cars' + fetched 'cars' → 去重為 1
    });
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

  it('carries monthlyVolumes content into the snapshot row (needed by trend / keywords views, §5.1)', async () => {
    const { processor, saveResult, mergeExpansion } = buildHarness();
    const volumes = [{ year: 2026, month: 1, searches: 42 }];
    // 注入帶真實逐月搜量的權威列，驗證**內容**確實流入 snapshot（非僅型別為陣列 / 硬編 []）。
    mergeExpansion.mockReturnValue([keyword('running shoes', { monthlyVolumes: volumes })]);

    await processor.process(fakeJob(buildPayload()) as never);

    const [, rows] = saveResult.mock.calls[0] as [string, SavedRow[]];
    // 修正前 toSnapshotRow 不含 monthlyVolumes → 執行期 undefined（red）；修正後逐月搜量原樣流入（§9.2）。
    expect(rows[0].monthlyVolumes).toEqual(volumes);
  });

  it('logs and persists without throwing on the failed worker event', async () => {
    const { processor } = buildHarness();

    await expect(
      processor.onFailed(terminalFailedJob() as never, new Error('boom')),
    ).resolves.toBeUndefined();
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

    it('guards worker DB writes against overwriting a terminal partial row (M7-R10 completes M7-R5)', async () => {
      const { processor, prismaUpdateMany } = buildHarness();
      await processor.process(fakeJob(buildPayload()) as never);
      // partial 為終態（M7-R5）：worker 的條件式寫入（markStatus running + 進度鏡像）notIn 須含 partial，否則
      // stalled 重跑會把已固化 partial 列推回 running → resurrection + orphan snapshot（第 4 個 terminal guard）。
      const guarded = argsOf(prismaUpdateMany).filter((a) => a.where.status?.notIn);
      expect(guarded.length).toBeGreaterThan(0);
      for (const write of guarded) {
        expect(write.where.status?.notIn).toContain('partial');
      }
    });

    it('mirrors intermediate progress (fetch/metrics) to the DB via the guarded path', async () => {
      const { processor, prismaUpdateMany } = buildHarness();
      await processor.process(fakeJob(buildPayload()) as never);

      const progressWrites = argsOf(prismaUpdateMany).filter((a) => a.data.progress !== undefined);
      expect(progressWrites.length).toBeGreaterThan(0);
      // 中間階段（fetch/metrics）由 processor 鏡像 DB。終態 intent/100 **不**由此驗證——它由 saveResult 與
      // status='completed' 原子寫入（見 result-snapshot.service.spec）；processor 的 report('intent') DB 鏡像
      // 在 production 因已終態 no-op（M3-R5）。SSE 達 100 由 TC-11 的 job.updateProgress 覆蓋。
      expect(progressWrites.map((w) => w.data.progress?.phase)).toEqual(
        expect.arrayContaining(['fetch', 'metrics']),
      );
      // 進度鏡像須條件式（notIn 終態）——已 cancel 但仍在跑的 job 不被推回進度（M3-R1 review）。
      for (const write of progressWrites) {
        expect(write.where.status?.notIn).toEqual(
          expect.arrayContaining(['completed', 'failed', 'canceled']),
        );
      }
    });

    it('persists status=failed + error on the FINAL failed attempt (FR-8 poll)', async () => {
      const { processor, prismaUpdateMany } = buildHarness();
      prismaUpdateMany.mockClear();

      await processor.onFailed(terminalFailedJob() as never, new Error('boom'));

      const failed = argsOf(prismaUpdateMany).find((a) => a.data.status === 'failed');
      expect(failed?.data.error).toBe('boom');
      expect(failed?.where.status?.notIn).toEqual(
        expect.arrayContaining(['completed', 'failed', 'canceled']),
      );
    });

    it('does NOT persist failed on a retryable intermediate attempt (BullMQ fires per-attempt)', async () => {
      // BullMQ 對「每次」失敗都發 failed（含將被重試者）。若中途瞬時錯誤就寫終態 failed，會擋掉
      // 後續成功重試的 running/completed 寫入（markStatus/saveResult 皆守 notIn 終態）→ 完成的 job
      // 在 DB 永遠停在 failed。只有 finishedOn 已設（最終態）才可寫。
      const { processor, prismaUpdateMany } = buildHarness();
      prismaUpdateMany.mockClear();

      await processor.onFailed(retryableFailedJob() as never, new Error('transient'));

      expect(argsOf(prismaUpdateMany).find((a) => a.data.status === 'failed')).toBeUndefined();
    });

    it('scrubs secrets from the persisted error message (NFR-5, §5.1 error 欄)', async () => {
      // 上游錯誤訊息可能夾帶連線字串密碼／bearer token——§5.1 標明此欄「祕密不入」。
      const { processor, prismaUpdateMany } = buildHarness();
      prismaUpdateMany.mockClear();

      await processor.onFailed(
        terminalFailedJob() as never,
        new Error('connect failed: postgres://user:s3cr3t@db:5432/app'),
      );

      const failed = argsOf(prismaUpdateMany).find((a) => a.data.status === 'failed');
      expect(failed?.data.error).not.toContain('s3cr3t');
      expect(failed?.data.error).toContain('[Redacted]');
    });

    it('does not fail the job when the DB state mirror errors (best-effort, M3-R6/#2)', async () => {
      const { processor, prismaUpdateMany } = buildHarness();
      // 所有 markStatus（running/progress）DB 寫入暫時性錯誤——不應讓已成功取數/貼標的 job 失敗重跑。
      prismaUpdateMany.mockRejectedValue(new Error('db blip'));

      await expect(processor.process(fakeJob(buildPayload()) as never)).resolves.toEqual({
        count: 2,
      });
    });

    it('scrubs secrets from the best-effort mirror error log (NFR-5, M3-R6/#9)', async () => {
      const { processor, prismaUpdateMany } = buildHarness();
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      prismaUpdateMany.mockRejectedValue(
        new Error('connect failed: postgres://user:s3cr3t@db:5432/app'),
      );

      await processor.process(fakeJob(buildPayload()) as never);

      const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).not.toContain('s3cr3t');
      expect(logged).toContain('[Redacted]');
      warnSpy.mockRestore();
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
        processor.onFailed(terminalFailedJob() as never, new Error('boom')),
      ).resolves.toBeUndefined();
    });
  });

  describe('wires WORKER_CONCURRENCY onto the worker (M3-R2 / NFR-8)', () => {
    interface FakeWorker {
      concurrency: number;
      run: jest.Mock;
    }
    /** WorkerHost.worker getter 讀私有 `_worker`（生產由 BullExplorer 設）；測試注入假 worker。 */
    function withFakeWorker(processor: KeywordAnalysisProcessor): FakeWorker {
      const worker: FakeWorker = { concurrency: 1, run: jest.fn().mockResolvedValue(undefined) };
      (processor as unknown as { _worker: FakeWorker })._worker = worker;
      return worker;
    }

    it('sets worker.concurrency from config and starts the worker on bootstrap', async () => {
      const { processor } = buildHarness();
      const worker = withFakeWorker(processor);

      await processor.onApplicationBootstrap();

      // BullMQ 預設 concurrency=1（autorun:false 故須在此啟動）→ 接上 config 後 = WORKER_CONCURRENCY。
      expect(worker.concurrency).toBe(WORKER_CONCURRENCY);
      expect(worker.run).toHaveBeenCalledTimes(1);
    });

    it('logs a scrubbed error and does not crash bootstrap if worker run() rejects', async () => {
      const { processor } = buildHarness();
      const worker = withFakeWorker(processor);
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      // 錯誤訊息夾帶連線字串密碼 → log 須遮罩（NFR-5；catch 存在的理由）。
      worker.run.mockRejectedValueOnce(new Error('boot failed: redis://user:s3cr3t@host:6379'));

      await expect(processor.onApplicationBootstrap()).resolves.toBeUndefined();
      await new Promise((resolve) => setImmediate(resolve)); // 等 run().catch 的 microtask 跑完

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = String(errorSpy.mock.calls[0]?.[0]);
      expect(logged).not.toContain('s3cr3t');
      expect(logged).toContain('[Redacted]');
      errorSpy.mockRestore();
    });
  });

  describe('graceful shutdown drains the worker (T7.5 / TC-26 / NFR-9)', () => {
    interface FakeWorker {
      close: jest.Mock;
    }
    function withFakeWorker(processor: KeywordAnalysisProcessor): FakeWorker {
      const worker: FakeWorker = { close: jest.fn().mockResolvedValue(undefined) };
      (processor as unknown as { _worker: FakeWorker })._worker = worker;
      return worker;
    }

    it('closes the worker on onModuleDestroy (stop intake + await in-flight before deps close)', async () => {
      const { processor } = buildHarness();
      const worker = withFakeWorker(processor);

      await processor.onModuleDestroy();

      // 本模組相依連線模組 → Nest 反相依序先銷毀本模組，故 worker.close 早於 Prisma/cache/Redis 連線關閉。
      expect(worker.close).toHaveBeenCalledTimes(1);
    });

    it('awaits worker.close so in-flight jobs finish before onModuleDestroy resolves', async () => {
      const { processor } = buildHarness();
      let drained = false;
      const worker: FakeWorker = {
        close: jest.fn(
          () =>
            new Promise<void>((resolve) =>
              setImmediate(() => {
                drained = true;
                resolve();
              }),
            ),
        ),
      };
      (processor as unknown as { _worker: FakeWorker })._worker = worker;

      await processor.onModuleDestroy();

      // 若未 await，onModuleDestroy 會在 close 的排空完成前 resolve → 連線可能先關（T7.5 要防的洩漏）。
      expect(drained).toBe(true);
    });

    it('is a no-op when no worker was created (unbootstrapped / partial tests)', async () => {
      const { processor } = buildHarness();
      await expect(processor.onModuleDestroy()).resolves.toBeUndefined();
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

  // T7.1（Design §11 兩層重試分工）：Ads 暫時性配額經 job 內退避仍耗盡 → UnrecoverableError（不整 job 重試、
  // 不重打 Ads）；暫時性基礎設施錯誤 → 原樣拋 → BullMQ 依 attempts 整 job 重試。
  describe('two-layer retry split (T7.1)', () => {
    it('maps an exhausted Ads quota error to UnrecoverableError (no whole-job retry)', async () => {
      const { processor, expandStreamRaw } = buildHarness();
      expandStreamRaw.mockImplementation(
        throwing({ errors: [{ error_code: { quota_error: 'RESOURCE_EXHAUSTED' } }] }),
      );

      await expect(processor.process(fakeJob(buildPayload()) as never)).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
    });

    it('maps a non-retryable Ads error (InvalidArgument) to UnrecoverableError (S1: no retry-amplifying replay)', async () => {
      const { processor, expandStreamRaw } = buildHarness();
      expandStreamRaw.mockImplementation(
        throwing({ errors: [{ error_code: { request_error: 'INVALID_ARGUMENT' } }] }),
      );

      await expect(processor.process(fakeJob(buildPayload()) as never)).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
    });

    it('rethrows a transient infra error unchanged (BullMQ whole-job retry)', async () => {
      const { processor, expandStreamRaw } = buildHarness();
      const infra = Object.assign(new Error('conn reset'), { code: 'ECONNRESET' });
      expandStreamRaw.mockImplementation(throwing(infra));

      await expect(processor.process(fakeJob(buildPayload()) as never)).rejects.toBe(infra);
    });

    it('scrubs secrets from the UnrecoverableError message (BullMQ failedReason at-rest, NFR-5, M7-R1)', async () => {
      const { processor, expandStreamRaw } = buildHarness();
      // 終態 Ads 錯誤，訊息夾帶連線字串密碼 → UnrecoverableError.message 成為 BullMQ job.failedReason（Redis
      // at-rest）→ 須遮罩（M7-R1 defense-in-depth）。SSE client-facing 出站另於 JobEventsService.route 遮罩。
      const terminal = Object.assign(
        new Error('Ads client init failed: redis://user:s3cr3tpassword@cache:6379'),
        { errors: [{ error_code: { request_error: 'INVALID_ARGUMENT' } }] },
      );
      expandStreamRaw.mockImplementation(throwing(terminal));

      const err = await processor
        .process(fakeJob(buildPayload()) as never)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(UnrecoverableError);
      expect((err as Error).message).not.toContain('s3cr3tpassword');
      expect((err as Error).message).toContain('[Redacted]');
    });
  });

  // T7.1 partial 降級（Design §11「達上限 → partial」）：expand 串流中途遇 job 級終態錯誤但已取得部分候選 →
  // 標 status='partial'、保留已固化列（不整批丟、非失敗）。暫時性錯誤/無候選 → 不 partial（重試｜終態失敗）。
  describe('partial degradation (T7.1)', () => {
    const QUOTA_EXHAUSTED = { errors: [{ error_code: { quota_error: 'RESOURCE_EXHAUSTED' } }] };

    it('saves a partial snapshot (status=partial) on a terminal Ads error after some data was gathered', async () => {
      const { processor, expandStreamRaw, saveResult } = buildHarness();
      expandStreamRaw.mockImplementation(() => oneBatchThenThrow(QUOTA_EXHAUSTED));

      const result = await processor.process(fakeJob(buildPayload()) as never);

      // 未拋（partial = job 成功、非失敗）；已取部分以 'partial' 固化，列 intent 為空（貼標未完成）。
      expect(saveResult).toHaveBeenCalledWith(
        'a-1',
        expect.arrayContaining([expect.objectContaining({ intent: [] })]),
        'partial',
      );
      expect(result).toHaveProperty('count');
    });

    it('does NOT save partial when the terminal error hits before any data (→ UnrecoverableError)', async () => {
      const { processor, expandStreamRaw, saveResult } = buildHarness();
      expandStreamRaw.mockImplementation(throwing(QUOTA_EXHAUSTED));

      await expect(processor.process(fakeJob(buildPayload()) as never)).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(saveResult).not.toHaveBeenCalled();
    });

    it('does NOT save partial for a transient infra error even with data (rethrows → BullMQ retry)', async () => {
      const { processor, expandStreamRaw, saveResult } = buildHarness();
      const infra = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      expandStreamRaw.mockImplementation(() => oneBatchThenThrow(infra));

      await expect(processor.process(fakeJob(buildPayload()) as never)).rejects.toBe(infra);
      expect(saveResult).not.toHaveBeenCalled();
    });
  });

  // T7.2（NFR-6 / TC-30）：每 job 一筆結構化可觀測 log——各 phase 耗時 + expanded/labeled/total。
  describe('observability metrics (T7.2 / TC-30)', () => {
    interface MetricsFields {
      analysisId: string;
      status: string;
      phases: Record<string, number>;
      expanded: number;
      labeled: number;
      total: number;
      cacheHitRate: number | null;
      externalCalls: number;
      retries: number;
    }

    it('emits one structured per-job log with phase timings + expanded/labeled/total', async () => {
      const { processor, metricsLog } = buildHarness();

      await processor.process(fakeJob(buildPayload()) as never);

      expect(metricsLog.info).toHaveBeenCalledTimes(1);
      const [fields, message] = metricsLog.info.mock.calls[0] as [MetricsFields, string];
      expect(message).toBe('job metrics');
      expect(fields.analysisId).toBe('a-1');
      expect(fields.status).toBe('completed');
      expect(typeof fields.phases.expand).toBe('number'); // 各 phase 耗時（結構化）
      expect(typeof fields.phases.persist).toBe('number');
      expect(fields).toMatchObject({ expanded: 2, labeled: 2, total: 2 }); // expand 模式：2 關鍵字
      // TC-30 全欄位就位（值於服務層計數——AdsRateLimiter/MetricsCache 各自測；此處只驗欄位結構齊全）。
      expect(fields).toHaveProperty('cacheHitRate');
      expect(fields).toHaveProperty('externalCalls');
      expect(fields).toHaveProperty('retries');
    });

    it('emits metrics with status=failed when a job fails (observable failed jobs)', async () => {
      const { processor, metricsLog, expandStreamRaw } = buildHarness();
      // 終態 Ads 錯誤、無累積候選 → UnrecoverableError（失敗）。
      expandStreamRaw.mockImplementation(
        throwing({ errors: [{ error_code: { quota_error: 'RESOURCE_EXHAUSTED' } }] }),
      );

      await expect(processor.process(fakeJob(buildPayload()) as never)).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(metricsLog.info).toHaveBeenCalledWith(
        expect.objectContaining({ analysisId: 'a-1', status: 'failed' }),
        'job metrics',
      );
    });

    it('reports expanded=0 for exact mode (no expansion phase)', async () => {
      const { processor, metricsLog } = buildHarness();
      const payload = buildPayload({
        params: { geo: 'g', language: 'l', mode: 'exact', includeAdult: false },
      });

      await processor.process(fakeJob(payload) as never);

      const [fields] = metricsLog.info.mock.calls[0] as [{ expanded: number }, string];
      expect(fields.expanded).toBe(0); // exact 模式無 expand 階段
    });

    it('tags the metrics log status=partial when the job degrades (T7.1 partial)', async () => {
      const { processor, metricsLog, expandStreamRaw } = buildHarness();
      expandStreamRaw.mockImplementation(() =>
        oneBatchThenThrow({ errors: [{ error_code: { quota_error: 'RESOURCE_EXHAUSTED' } }] }),
      );

      await processor.process(fakeJob(buildPayload()) as never);

      expect(metricsLog.info).toHaveBeenCalledWith(
        expect.objectContaining({ analysisId: 'a-1', status: 'partial' }),
        'job metrics',
      );
    });

    it('is best-effort: a throwing metrics logger never fails the (already-persisted) job', async () => {
      const { processor, metricsLog } = buildHarness();
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      // 觀測副作用**絕不**可讓已持久化的 job 失敗——否則 catch 誤判為 job 錯誤 → BullMQ 重跑已完成
      // job、重打 Ads/LLM。錯誤訊息夾帶連線字串密碼 → 須經 scrubSecrets 遮罩（NFR-5）。
      metricsLog.info.mockImplementation(() => {
        throw new Error('logger boom redis://user:s3cr3t@host:6379');
      });

      // job 仍成功（emitMetrics 吞錯）——不因觀測失敗而 reject。
      await expect(processor.process(fakeJob(buildPayload()) as never)).resolves.toHaveProperty(
        'count',
      );

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = String(warnSpy.mock.calls[0]?.[0]);
      expect(logged).toContain('metrics emit failed');
      expect(logged).not.toContain('s3cr3t'); // 遮罩後不得外洩密碼
      warnSpy.mockRestore();
    });
  });
});
