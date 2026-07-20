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
}
function build(opts: BuildOpts = {}) {
  const fetchAiOverviews = jest.fn(() => Promise.resolve(opts.aiOverviews ?? []));
  const fetchAiModes = jest.fn(() => Promise.resolve(opts.aiModes ?? []));
  const fetchBingCopilot = jest.fn(() => Promise.resolve(opts.copilots ?? []));
  const serpAi = { fetchAiOverviews, fetchAiModes, fetchBingCopilot } as unknown as SerpAiProvider;

  const markStatus = jest.fn(() => Promise.resolve());
  const updateProgress = jest.fn(() => Promise.resolve());
  const runRepo = { markStatus, updateProgress } as unknown as AiSearchRunRepository;

  const deleteByJobId = jest.fn(() => Promise.resolve());
  const readRawExtensionCaptures = jest.fn(() => Promise.resolve(opts.rawExtension ?? []));
  const persistCanonical = jest.fn((_jobId: string, _owner: string | null, rows: unknown[]) =>
    opts.persistError ? Promise.reject(opts.persistError) : Promise.resolve((rows as []).length),
  );
  const captureRepo = {
    deleteByJobId,
    readRawExtensionCaptures,
    persistCanonical,
  } as unknown as AiSearchCaptureRepository;

  const processor = new AiSearchProcessor(serpAi, runRepo, captureRepo, { queueConcurrency: 3 });
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
      expect(fetchAiOverviews).toHaveBeenCalledWith(['asus zenbook']);
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

    it('pulls aiMode and bingCopilot via their provider methods when those channels are requested', async () => {
      const { processor, fetchAiModes, fetchBingCopilot, persistCanonical } = build({
        aiModes: [{ query: 'q', aiMode: serpCanonical('aiMode', 'q'), creditsUsed: 1 }],
        copilots: [{ query: 'q', copilot: serpCanonical('bingCopilot', 'q'), creditsUsed: 1 }],
      });
      const { j } = makeJob({ channels: ['aiMode', 'bingCopilot'], keywords: ['q'] });
      const result = await processor.process(j);
      expect(fetchAiModes).toHaveBeenCalledWith(['q']);
      expect(fetchBingCopilot).toHaveBeenCalledWith(['q']);
      const persisted = persistCanonical.mock.calls[0][2] as AiSearchCanonical[];
      expect(persisted.map((c) => c.channel).sort()).toEqual(['aiMode', 'bingCopilot']);
      expect(result.status).toBe('completed');
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
