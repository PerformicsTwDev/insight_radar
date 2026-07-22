import type { Job, Worker } from 'bullmq';
import type { CaptureChannel } from '../captures/dto/capture-ingest.dto';
import type { AiSearchCanonical } from '../captures/mapping/canonical.types';
import type { AiSearchJobPayload } from '../queue/ai-search-job.types';
import type {
  SerpAiProvider,
  SerpApiAiModeResult,
  SerpApiAiOverviewResult,
  SerpApiBingCopilotResult,
} from '../serp/serpapi-ai.types';
import type { AiAnalysisService } from '../ai-visibility/ai-analysis.service';
import { AiSearchProcessor } from './ai-search.processor';
import type {
  AiSearchCaptureRepository,
  RawExtensionCapture,
} from './ai-search-capture.repository';
import type { AiSearchRunRepository } from './ai-search-run.repository';

const OWNER = null;

function serpCanonical(channel: CaptureChannel, query: string): AiSearchCanonical {
  return {
    source: 'serpapi',
    channel,
    schemaVersion: 'serpapi-v1',
    query,
    blocks: ['aio block'],
    references: [],
    capturedAt: new Date().toISOString(),
  };
}

/** raw extension capture whose payload is mappable by `mapAiCapture` (query core field present). */
function extRow(channel: CaptureChannel, query: string): RawExtensionCapture {
  return {
    source: 'extension',
    schemaVersion: 'v1',
    channel,
    payload: { query, answer: `answer for ${query}`, references: [] },
    capturedAt: new Date(),
  };
}

interface BuildOpts {
  aiOverviews?: SerpApiAiOverviewResult[];
  aiModes?: SerpApiAiModeResult[];
  copilots?: SerpApiBingCopilotResult[];
  rawExtension?: RawExtensionCapture[];
  persistError?: Error;
  /** non-Error rejection to exercise the `String(error)` scrub fallback (via mockRejectedValue, lint-safe). */
  deleteError?: unknown;
  /** T15.5 分析 stage 降級數（needsReview>0 → run partial）；預設 0（無降級）。 */
  analysisNeedsReview?: number;
  /** #683/M15-R1: captures a prior attempt already persisted for the job (reused on BullMQ retry, no re-charge). */
  persistedCanonical?: AiSearchCanonical[];
  /** #683/M15-R1: force analyzeAndPersist to reject (models a transient LLM/infra failure mid-analysis). */
  analysisError?: Error;
}
function build(opts: BuildOpts = {}) {
  const fetchAiOverviews = jest.fn(() => Promise.resolve(opts.aiOverviews ?? []));
  const fetchAiModes = jest.fn(() => Promise.resolve(opts.aiModes ?? []));
  const fetchBingCopilot = jest.fn(() => Promise.resolve(opts.copilots ?? []));
  const serpAi = { fetchAiOverviews, fetchAiModes, fetchBingCopilot } as unknown as SerpAiProvider;

  const markStatus = jest.fn(() => Promise.resolve());
  const updateProgress = jest.fn((_runId: string, _progress: { phase: string; percent: number }) =>
    Promise.resolve(),
  );
  const runRepo = { markStatus, updateProgress } as unknown as AiSearchRunRepository;

  const deleteByJobId =
    'deleteError' in opts
      ? jest.fn().mockRejectedValue(opts.deleteError)
      : jest.fn(() => Promise.resolve());
  const readRawExtensionCaptures = jest.fn<Promise<RawExtensionCapture[]>, [unknown]>(() =>
    Promise.resolve(opts.rawExtension ?? []),
  );
  const persistCanonical = jest.fn((_jobId: string, _owner: string | null, rows: unknown[]) =>
    opts.persistError ? Promise.reject(opts.persistError) : Promise.resolve((rows as []).length),
  );
  const readCanonicalByJobId = jest.fn<Promise<AiSearchCanonical[]>, [string]>(() =>
    Promise.resolve(opts.persistedCanonical ?? []),
  );
  const captureRepo = {
    deleteByJobId,
    readRawExtensionCaptures,
    persistCanonical,
    readCanonicalByJobId,
  } as unknown as AiSearchCaptureRepository;

  // T15.5 分析 stage stub：抓取 processor 只關心其回傳的 `needsReview`（→ partial 收斂）；分析編排/持久化
  // 由 ai-analysis.service.spec / ai-analysis-job.int-spec 獨立把關（不在此重測）。
  const analyzeAndPersist = jest.fn(
    (_input: { jobId: string; brandProfileId: string | null; captures: AiSearchCanonical[] }) =>
      opts.analysisError
        ? Promise.reject(opts.analysisError)
        : Promise.resolve({
            answersCount: 0,
            citedCount: 0,
            metricsCount: 0,
            needsReview: opts.analysisNeedsReview ?? 0,
          }),
  );
  const aiAnalysis = { analyzeAndPersist } as unknown as AiAnalysisService;

  const processor = new AiSearchProcessor(serpAi, runRepo, captureRepo, aiAnalysis, {
    queueConcurrency: 3,
    captureLookbackDays: 30,
    captureScanLimit: 500,
  });
  return {
    processor,
    fetchAiOverviews,
    fetchAiModes,
    fetchBingCopilot,
    markStatus,
    updateProgress,
    deleteByJobId,
    readRawExtensionCaptures,
    persistCanonical,
    readCanonicalByJobId,
    analyzeAndPersist,
  };
}

function makeJob(
  over: Partial<AiSearchJobPayload> = {},
  attempt: { attemptsMade?: number; attempts?: number } = {},
): { j: Job<AiSearchJobPayload>; jobUpdate: jest.Mock } {
  const jobUpdate = jest.fn(() => Promise.resolve(undefined));
  const j = {
    data: {
      runId: 'run-1',
      ownerId: OWNER,
      keywords: ['asus zenbook'],
      channels: ['chatGpt', 'aiOverview'] as CaptureChannel[],
      brandProfileId: null,
      params: { schemaVersion: 'ai-search-v1' },
      ...over,
    },
    updateProgress: jobUpdate,
    attemptsMade: attempt.attemptsMade ?? 4,
    opts: { attempts: 'attempts' in attempt ? attempt.attempts : 5 },
  } as unknown as Job<AiSearchJobPayload>;
  return { j, jobUpdate };
}

/** TC-77 (T14.6 · FR-41/AC-41.2): AiSearchProcessor — SerpAPI pull + extension push merge → partial. */
describe('TC-77: AiSearchProcessor', () => {
  describe('lifecycle', () => {
    it('onApplicationBootstrap sets worker concurrency from config and runs it', async () => {
      const { processor } = build();
      const run = jest.fn(() => Promise.resolve(undefined));
      (processor as unknown as { _worker: Worker })._worker = {
        concurrency: 0,
        run,
      } as unknown as Worker;
      await processor.onApplicationBootstrap();
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('onModuleDestroy drains the worker (no-op when absent)', async () => {
      const { processor } = build();
      await expect(processor.onModuleDestroy()).resolves.toBeUndefined();
      const close = jest.fn(() => Promise.resolve(undefined));
      (processor as unknown as { _worker: Worker })._worker = { close } as unknown as Worker;
      await processor.onModuleDestroy();
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe('process (merge)', () => {
    it('merges SerpAPI pull + extension push into ai_search_captures (jobId), completed when all channels covered', async () => {
      const { processor, persistCanonical, deleteByJobId, markStatus, fetchAiOverviews } = build({
        aiOverviews: [
          {
            query: 'asus zenbook',
            aiOverview: serpCanonical('aiOverview', 'asus zenbook'),
            creditsUsed: 1,
          },
        ],
        rawExtension: [extRow('chatGpt', 'asus zenbook')],
      });
      const { j } = makeJob();
      const result = await processor.process(j);

      expect(deleteByJobId).toHaveBeenCalledWith('run-1'); // clean slate
      // per-job credit ledger 傳入（NFR-18 / #581）——跨渠道共用一份 { spent }（cap 行為於 provider spec 驗）。
      expect(fetchAiOverviews).toHaveBeenCalledWith(['asus zenbook'], expect.anything());
      const persisted = persistCanonical.mock.calls[0][2] as AiSearchCanonical[];
      expect(persisted).toHaveLength(2); // aiOverview (serpapi) + chatGpt (extension)
      expect(persisted.map((c) => c.channel).sort()).toEqual(['aiOverview', 'chatGpt']);
      expect(result).toEqual({ status: 'completed', captureCount: 2 });
      expect(markStatus).toHaveBeenNthCalledWith(1, 'run-1', 'running');
      expect(markStatus).toHaveBeenLastCalledWith('run-1', 'completed', { captureCount: 2 });
    });

    it('marks partial (not whole-batch failure) when a requested channel yields no capture (INV-6)', async () => {
      const { processor, markStatus } = build({
        rawExtension: [extRow('chatGpt', 'asus zenbook')], // googleSearch missing
      });
      const { j } = makeJob({ channels: ['chatGpt', 'googleSearch'] });
      const result = await processor.process(j);
      expect(result.status).toBe('partial');
      expect(markStatus).toHaveBeenLastCalledWith('run-1', 'partial', { captureCount: 1 });
    });

    it('runs the T15.5 analysis stage with the merged captures + brandProfileId (jobId=runId)', async () => {
      const { processor, analyzeAndPersist } = build({
        aiOverviews: [
          {
            query: 'asus zenbook',
            aiOverview: serpCanonical('aiOverview', 'asus zenbook'),
            creditsUsed: 1,
          },
        ],
      });
      const { j } = makeJob({ channels: ['aiOverview'], brandProfileId: 'bp-7' });
      await processor.process(j);
      const arg = analyzeAndPersist.mock.calls[0][0];
      expect(arg.jobId).toBe('run-1');
      expect(arg.brandProfileId).toBe('bp-7');
      expect(arg.captures).toHaveLength(1);
      expect(arg.captures[0].channel).toBe('aiOverview');
    });

    it('marks partial when analysis degrades (needsReview>0) even though all channels are covered (AC-42.5)', async () => {
      const { processor, markStatus } = build({
        aiOverviews: [
          {
            query: 'asus zenbook',
            aiOverview: serpCanonical('aiOverview', 'asus zenbook'),
            creditsUsed: 1,
          },
        ],
        analysisNeedsReview: 3, // some query/line LLM degraded
      });
      const { j } = makeJob({ channels: ['aiOverview'] });
      const result = await processor.process(j);
      expect(result.status).toBe('partial'); // fetch fully covered, but analysis degraded → partial
      expect(markStatus).toHaveBeenLastCalledWith('run-1', 'partial', { captureCount: 1 });
    });

    it('SerpAPI disabled (provider short-circuits null) → that channel missing → partial, zero captures', async () => {
      const { processor, persistCanonical, markStatus } = build({
        aiOverviews: [{ query: 'asus zenbook', aiOverview: null, creditsUsed: 0 }], // disabled no-op
      });
      const { j } = makeJob({ channels: ['aiOverview'] });
      const result = await processor.process(j);
      expect(result).toEqual({ status: 'partial', captureCount: 0 });
      expect(persistCanonical.mock.calls[0][2]).toHaveLength(0);
      expect(markStatus).toHaveBeenLastCalledWith('run-1', 'partial', { captureCount: 0 });
    });

    it('drops extension captures whose query is outside the requested keyword set', async () => {
      const { processor, persistCanonical } = build({
        rawExtension: [extRow('chatGpt', 'asus zenbook'), extRow('chatGpt', 'unrelated term')],
      });
      const { j } = makeJob({ channels: ['chatGpt'], keywords: ['asus zenbook'] });
      const result = await processor.process(j);
      const persisted = persistCanonical.mock.calls[0][2] as AiSearchCanonical[];
      expect(persisted).toHaveLength(1);
      expect(persisted[0].query).toBe('asus zenbook');
      expect(result.status).toBe('completed');
    });

    it('bounds the extension capture scan by the configured lookback window + scan limit ([8] M14-R3/#579)', async () => {
      const { processor, readRawExtensionCaptures } = build({
        rawExtension: [extRow('chatGpt', 'asus zenbook')],
      });
      const before = Date.now();
      const { j } = makeJob({ channels: ['chatGpt'], keywords: ['asus zenbook'] });
      await processor.process(j);
      const after = Date.now();

      const arg = readRawExtensionCaptures.mock.calls[0][0] as {
        capturedAfter: Date;
        limit: number;
      };
      expect(arg.limit).toBe(500);
      // capturedAfter ≈ now - 30d (config), computed at job time — a real lower bound, not undefined.
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(arg.capturedAfter).toBeInstanceOf(Date);
      expect(arg.capturedAfter.getTime()).toBeGreaterThanOrEqual(before - thirtyDaysMs - 1000);
      expect(arg.capturedAfter.getTime()).toBeLessThanOrEqual(after - thirtyDaysMs + 1000);
    });

    it('only calls the SerpAPI provider methods for requested serpapi channels', async () => {
      const { processor, fetchAiOverviews, fetchAiModes, fetchBingCopilot } = build({
        rawExtension: [extRow('chatGpt', 'asus zenbook')],
      });
      const { j } = makeJob({ channels: ['chatGpt'] }); // no serpapi channel
      await processor.process(j);
      expect(fetchAiOverviews).not.toHaveBeenCalled();
      expect(fetchAiModes).not.toHaveBeenCalled();
      expect(fetchBingCopilot).not.toHaveBeenCalled();
    });

    it('marks failed + rethrows on an infra error at the final attempt (BullMQ retry semantics)', async () => {
      const { processor, markStatus } = build({ persistError: new Error('db down') });
      const { j } = makeJob({}, { attemptsMade: 4, attempts: 5 });
      await expect(processor.process(j)).rejects.toThrow('db down');
      expect(markStatus).toHaveBeenLastCalledWith('run-1', 'failed', expect.objectContaining({}));
    });

    it('does not mark failed on a non-final attempt (leaves it for BullMQ to retry)', async () => {
      const { processor, markStatus } = build({ persistError: new Error('transient') });
      const { j } = makeJob({}, { attemptsMade: 0, attempts: 5 });
      await expect(processor.process(j)).rejects.toThrow('transient');
      expect(markStatus).not.toHaveBeenCalledWith('run-1', 'failed', expect.anything());
    });

    it('treats an undefined attempts opt as the final attempt (?? 1 fallback → marks failed)', async () => {
      const { processor, markStatus } = build({ persistError: new Error('boom') });
      const { j } = makeJob({}, { attemptsMade: 0, attempts: undefined }); // opts.attempts undefined → ?? 1
      await expect(processor.process(j)).rejects.toThrow('boom');
      expect(markStatus).toHaveBeenLastCalledWith('run-1', 'failed', expect.objectContaining({}));
    });

    it('scrubs a non-Error rejection via the String(error) fallback and still marks failed', async () => {
      const { processor, markStatus } = build({ deleteError: 'raw string failure' });
      const { j } = makeJob({}, { attemptsMade: 4, attempts: 5 });
      await expect(processor.process(j)).rejects.toBe('raw string failure');
      expect(markStatus).toHaveBeenLastCalledWith('run-1', 'failed', expect.objectContaining({}));
    });

    it('pulls aiMode and bingCopilot via their provider methods when those channels are requested', async () => {
      const { processor, fetchAiModes, fetchBingCopilot, persistCanonical } = build({
        aiModes: [{ query: 'q', aiMode: serpCanonical('aiMode', 'q'), creditsUsed: 1 }],
        copilots: [{ query: 'q', copilot: serpCanonical('bingCopilot', 'q'), creditsUsed: 1 }],
      });
      const { j } = makeJob({ channels: ['aiMode', 'bingCopilot'], keywords: ['q'] });
      const result = await processor.process(j);
      // 同一 per-job ledger 傳給三個渠道 method（NFR-18 / #581）。
      expect(fetchAiModes).toHaveBeenCalledWith(['q'], expect.anything());
      expect(fetchBingCopilot).toHaveBeenCalledWith(['q'], expect.anything());
      const persisted = persistCanonical.mock.calls[0][2] as AiSearchCanonical[];
      expect(persisted.map((c) => c.channel).sort()).toEqual(['aiMode', 'bingCopilot']);
      expect(result.status).toBe('completed');
    });

    it('keeps a completed run completed when the trailing done-progress DB write fails (INV-3, #578)', async () => {
      // Regression for M14-R2: process() commits the terminal status (markStatus completed/partial)
      // BEFORE the trailing reportProgress('done', 100). A transient DB error on that post-terminal
      // progress write must NOT throw into the catch and flip the already-committed status to failed.
      const { processor, markStatus, updateProgress } = build({
        rawExtension: [extRow('chatGpt', 'asus zenbook')],
      });
      // Only the final 'done'/100 progress write fails; the earlier phase writes succeed so the run
      // reaches its terminal state normally (completed) before the failing write.
      updateProgress.mockImplementation(
        (_runId: string, progress: { phase: string; percent: number }) =>
          progress.percent >= 100
            ? Promise.reject(new Error('transient db error'))
            : Promise.resolve(),
      );
      const { j } = makeJob({ channels: ['chatGpt'] }); // final attempt (attemptsMade 4, attempts 5)
      const result = await processor.process(j);

      expect(result).toEqual({ status: 'completed', captureCount: 1 });
      expect(markStatus).toHaveBeenLastCalledWith('run-1', 'completed', { captureCount: 1 });
      expect(markStatus).not.toHaveBeenCalledWith('run-1', 'failed', expect.anything());
    });

    describe('BullMQ retry does not re-charge the paid SerpAPI pull (#683/M15-R1)', () => {
      it('reuses persisted captures on a retry (attemptsMade>0): no re-fetch, no clean-slate, no re-persist', async () => {
        const {
          processor,
          fetchAiOverviews,
          deleteByJobId,
          persistCanonical,
          readCanonicalByJobId,
        } = build({
          persistedCanonical: [
            serpCanonical('aiOverview', 'asus zenbook'),
            serpCanonical('chatGpt', 'asus zenbook'),
          ],
        });
        const { j } = makeJob(
          { channels: ['aiOverview', 'chatGpt'] },
          { attemptsMade: 1, attempts: 5 },
        );

        const result = await processor.process(j);

        // The paid pull + destructive clean-slate + re-persist must all be skipped on a retry.
        expect(fetchAiOverviews).not.toHaveBeenCalled();
        expect(deleteByJobId).not.toHaveBeenCalled();
        expect(persistCanonical).not.toHaveBeenCalled();
        expect(readCanonicalByJobId).toHaveBeenCalledWith('run-1');
        expect(result).toEqual({ status: 'completed', captureCount: 2 });
      });

      it('feeds the reused captures to the analysis stage (retry re-runs analysis only)', async () => {
        const { processor, analyzeAndPersist } = build({
          persistedCanonical: [serpCanonical('aiOverview', 'asus zenbook')],
        });
        const { j } = makeJob({ channels: ['aiOverview'] }, { attemptsMade: 2, attempts: 5 });

        await processor.process(j);

        const arg = analyzeAndPersist.mock.calls[0][0];
        expect(arg.captures).toHaveLength(1);
        expect(arg.captures[0].channel).toBe('aiOverview');
        expect(arg.captures[0].source).toBe('serpapi');
      });

      it('falls back to a full fetch on a retry when nothing was persisted (prior attempt failed pre-persist)', async () => {
        const { processor, fetchAiOverviews, deleteByJobId, persistCanonical } = build({
          persistedCanonical: [], // prior attempt threw before persisting → nothing durable to reuse
          aiOverviews: [
            {
              query: 'asus zenbook',
              aiOverview: serpCanonical('aiOverview', 'asus zenbook'),
              creditsUsed: 1,
            },
          ],
        });
        const { j } = makeJob({ channels: ['aiOverview'] }, { attemptsMade: 1, attempts: 5 });

        const result = await processor.process(j);

        expect(deleteByJobId).toHaveBeenCalledWith('run-1');
        expect(fetchAiOverviews).toHaveBeenCalledTimes(1);
        expect(persistCanonical).toHaveBeenCalledTimes(1);
        expect(result.status).toBe('completed');
      });

      it('first attempt (attemptsMade=0) never consults persisted captures — always a fresh fetch', async () => {
        const { processor, readCanonicalByJobId, fetchAiOverviews, deleteByJobId } = build({
          persistedCanonical: [serpCanonical('aiOverview', 'stale')],
          aiOverviews: [
            {
              query: 'asus zenbook',
              aiOverview: serpCanonical('aiOverview', 'asus zenbook'),
              creditsUsed: 1,
            },
          ],
        });
        const { j } = makeJob({ channels: ['aiOverview'] }, { attemptsMade: 0, attempts: 5 });

        await processor.process(j);

        expect(readCanonicalByJobId).not.toHaveBeenCalled();
        expect(deleteByJobId).toHaveBeenCalledWith('run-1');
        expect(fetchAiOverviews).toHaveBeenCalledTimes(1);
      });
    });

    // M15-R12/#701: close the M15-R1 residual window. The reuse-on-retry guard only spares the paid
    // pull once persistCanonical lands; a transient throw of any DB op BETWEEN the paid pull and
    // persist (extension read / progress write) aborts pre-persist → the retry sees nothing durable →
    // full re-fetch → the SerpAPI pull is charged twice. The paid pull must be the last thing before
    // persist, with only a best-effort cosmetic tick in between.
    describe('no re-charge on a transient failure between the paid pull and persist (#701/M15-R12)', () => {
      it('a transient extension-read failure aborts before the paid pull; the retry charges the pull exactly once', async () => {
        const { processor, fetchAiOverviews, readRawExtensionCaptures, persistCanonical } = build({
          aiOverviews: [
            {
              query: 'asus zenbook',
              aiOverview: serpCanonical('aiOverview', 'asus zenbook'),
              creditsUsed: 1,
            },
          ],
          rawExtension: [extRow('chatGpt', 'asus zenbook')],
        });
        // The extension read (a DB op sitting between the paid pull and persist in the buggy order)
        // throws transiently on the first attempt, then succeeds on the retry.
        readRawExtensionCaptures.mockRejectedValueOnce(new Error('transient ext read'));
        const payload = { channels: ['chatGpt', 'aiOverview'] as CaptureChannel[] };

        // Attempt 1 (non-final): aborts mid-gather → BullMQ will retry.
        const first = makeJob(payload, { attemptsMade: 0, attempts: 5 });
        await expect(processor.process(first.j)).rejects.toThrow('transient ext read');
        // Attempt 2 (retry): nothing was persisted → full fetch.
        const second = makeJob(payload, { attemptsMade: 1, attempts: 5 });
        const result = await processor.process(second.j);

        expect(result.status).toBe('completed');
        // The paid pull must run exactly once across both attempts (no double charge on retry).
        expect(fetchAiOverviews).toHaveBeenCalledTimes(1);
        expect(persistCanonical).toHaveBeenCalledTimes(1);
      });

      it('completes without a retry when the persisting-phase progress write fails after the paid pull (best-effort)', async () => {
        const { processor, fetchAiOverviews, updateProgress, persistCanonical, markStatus } = build(
          {
            aiOverviews: [
              {
                query: 'asus zenbook',
                aiOverview: serpCanonical('aiOverview', 'asus zenbook'),
                creditsUsed: 1,
              },
            ],
          },
        );
        // The DB progress write that sits between the paid pull and persist fails transiently.
        updateProgress.mockImplementation(
          (_runId: string, progress: { phase: string; percent: number }) =>
            progress.percent === 85
              ? Promise.reject(new Error('transient db error'))
              : Promise.resolve(),
        );
        const { j } = makeJob({ channels: ['aiOverview'] }, { attemptsMade: 0, attempts: 5 });

        const result = await processor.process(j);

        // The cosmetic progress tick must never throw into the catch and force a retry that re-charges.
        expect(result.status).toBe('completed');
        expect(fetchAiOverviews).toHaveBeenCalledTimes(1);
        expect(persistCanonical).toHaveBeenCalledTimes(1);
        expect(markStatus).not.toHaveBeenCalledWith('run-1', 'failed', expect.anything());
      });
    });

    it('completes even when job.updateProgress (SSE publish) fails — best-effort, non-blocking', async () => {
      const { processor, persistCanonical } = build({
        rawExtension: [extRow('chatGpt', 'asus zenbook')],
      });
      const { j } = makeJob({ channels: ['chatGpt'] });
      (j.updateProgress as jest.Mock).mockRejectedValue(new Error('sse gone'));
      const result = await processor.process(j);
      expect(result.status).toBe('completed');
      expect(persistCanonical).toHaveBeenCalledTimes(1);
    });
  });

  it('onApplicationBootstrap logs (does not throw) when worker.run() rejects', async () => {
    const { processor } = build();
    const run = jest.fn(() => Promise.reject(new Error('worker boom')));
    (processor as unknown as { _worker: Worker })._worker = {
      concurrency: 0,
      run,
    } as unknown as Worker;
    await expect(processor.onApplicationBootstrap()).resolves.toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve)); // let the rejected run() settle
    expect(run).toHaveBeenCalledTimes(1);
  });
});
