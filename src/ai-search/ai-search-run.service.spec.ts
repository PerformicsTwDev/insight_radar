import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from '../common/authenticated-user';
import type { CreateAiSearchAnalysisDto } from './ai-search.dto';
import type { CreateAiSearchRunInput, CreateAiSearchRunResult } from './ai-search-run.repository';
import { AiSearchRunRepository } from './ai-search-run.repository';
import { AiSearchRunService, type AiSearchRunConfig } from './ai-search-run.service';
import type { AiSearchRunView } from './ai-search-run.types';

const API: AuthenticatedUser = { kind: 'apiKey' };
const SESSION_A: AuthenticatedUser = { kind: 'session', id: 'user-A', email: 'a@x.io' };
const SESSION_B: AuthenticatedUser = { kind: 'session', id: 'user-B', email: 'b@x.io' };

const CONFIG: AiSearchRunConfig = {
  schemaVersion: 'ai-search-v1',
  analysisSchemaVersion: 'v1',
  jobAttempts: 5,
  jobBackoffMs: 3000,
  jobBackoffJitter: 0.2,
};

const DTO: CreateAiSearchAnalysisDto = {
  keywords: ['asus zenbook'],
  channels: ['chatGpt', 'aiOverview'],
};

interface BuildOpts {
  created?: boolean;
  runId?: string;
  staleState?: string | null; // getJob result state
  enqueueError?: Error;
  run?: AiSearchRunView | null;
  config?: Partial<AiSearchRunConfig>;
  /** T15.8a：owner-verify 用——`findAnalysisOwner(analysisId)` 的回傳（`{ownerId}` 或 null=未知）。 */
  analysisOwner?: { ownerId: string | null } | null;
}
function build(opts: BuildOpts = {}) {
  const queueAdd = jest.fn((_name: string, _data: unknown, _opts: unknown) =>
    opts.enqueueError ? Promise.reject(opts.enqueueError) : Promise.resolve(undefined),
  );
  const removeStale = jest.fn(() => Promise.resolve(undefined));
  const queueGetJob = jest.fn<Promise<unknown>, [string]>(() =>
    Promise.resolve(
      opts.staleState == null
        ? null
        : { getState: () => Promise.resolve(opts.staleState), remove: removeStale },
    ),
  );
  const queue = { add: queueAdd, getJob: queueGetJob } as unknown as Queue;

  const createRun = jest.fn<Promise<CreateAiSearchRunResult>, [CreateAiSearchRunInput]>(() =>
    Promise.resolve({ runId: opts.runId ?? 'run-1', created: opts.created ?? true }),
  );
  const findById = jest.fn(() => Promise.resolve(opts.run ?? null));
  const markStatus = jest.fn(() => Promise.resolve());
  const findAnalysisOwner = jest.fn(() => Promise.resolve(opts.analysisOwner ?? null));
  const repo = {
    createRun,
    findById,
    markStatus,
    findAnalysisOwner,
  } as unknown as AiSearchRunRepository;

  const service = new AiSearchRunService(queue, repo, { ...CONFIG, ...opts.config });
  return {
    service,
    queueAdd,
    queueGetJob,
    removeStale,
    createRun,
    findById,
    markStatus,
    findAnalysisOwner,
  };
}

const ANALYSIS_ID = '44444444-4444-4444-4444-444444444444';

/** TC-77 (T14.6 · FR-41/AC-41.1): AiSearchRunService — enqueue-only + idempotency + owner scope. */
describe('TC-77: AiSearchRunService', () => {
  it('create enqueues once (jobId=runId) and returns {jobId} — enqueue-only, no external calls', async () => {
    const { service, queueAdd, createRun } = build({ created: true, runId: 'run-1' });
    const res = await service.create(DTO, API);
    expect(res).toEqual({ jobId: 'run-1' });
    expect(createRun).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    // jobId option = runId (BullMQ dedup key)
    const [, , addOpts] = queueAdd.mock.calls[0];
    expect((addOpts as { jobId: string }).jobId).toBe('run-1');
  });

  it('enqueues normalized + deduped keywords in the payload (aligns with the idempotency key, M14-R6)', async () => {
    // Regression: the idempotency key collapses ['Nike','NIKE ','nike'] to a single run, but the job
    // payload used to carry the raw DTO keywords → pullSerpapi fetched the same normalized keyword 3×
    // (wasted SerpApi credits + duplicate canonical rows + inflated captureCount). The payload must be
    // canonicalized with the SAME normalizeText + dedupe single point as the idempotency key.
    const dto: CreateAiSearchAnalysisDto = {
      keywords: ['Nike', 'NIKE ', 'nike'],
      channels: ['aiOverview'],
    };
    const { service, queueAdd } = build({ created: true, runId: 'run-1' });
    await service.create(dto, API);
    const [, payload] = queueAdd.mock.calls[0];
    expect((payload as { keywords: string[] }).keywords).toEqual(['nike']);
  });

  it('folds the analysis schema version into the idempotency key — bumping AI_VISIBILITY_SCHEMA_VERSION forces a new run (M15-R5, #687)', async () => {
    // Root cause: the idempotency key used to carry only the fetch-layer schemaVersion, omitting the
    // analysis-layer AI_VISIBILITY_SCHEMA_VERSION that T15.5 in-job analysis stamps on ai_answers /
    // ai_cited_references / ai_visibility_metrics. Bumping the analysis version + re-POSTing the same
    // keywords/channels/brandProfileId then hit the existing completed run (not in
    // RESETTABLE_TERMINAL_STATUSES) → analysis never re-ran and rows stayed on the old version.
    const a = build({ config: { analysisSchemaVersion: 'v1' } });
    await a.service.create(DTO, API);
    const inputV1 = a.createRun.mock.calls[0][0];

    const b = build({ config: { analysisSchemaVersion: 'v2' } });
    await b.service.create(DTO, API);
    const inputV2 = b.createRun.mock.calls[0][0];

    expect(inputV1.idempotencyKey).not.toBe(inputV2.idempotencyKey);
    // The analysis version is also persisted as run provenance (params).
    expect(inputV1.params).toMatchObject({ analysisSchemaVersion: 'v1' });
    expect(inputV2.params).toMatchObject({ analysisSchemaVersion: 'v2' });
  });

  it('create is idempotent: an idempotency hit (created=false) returns the same jobId without enqueuing', async () => {
    const { service, queueAdd } = build({ created: false, runId: 'run-1' });
    const res = await service.create(DTO, API);
    expect(res).toEqual({ jobId: 'run-1' });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('create marks the run failed (not deleted) and rethrows when enqueue fails', async () => {
    const boom = new Error('redis down');
    const { service, markStatus } = build({ created: true, enqueueError: boom });
    await expect(service.create(DTO, API)).rejects.toThrow('redis down');
    expect(markStatus).toHaveBeenCalledWith('run-1', 'failed', expect.objectContaining({}));
  });

  it('create throws 503 (does not blind-add) when a prior attempt is still active', async () => {
    const { service, queueAdd, removeStale } = build({ created: true, staleState: 'active' });
    await expect(service.create(DTO, API)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(removeStale).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('create removes a stale non-active job then re-adds with the same jobId (reset re-enqueue)', async () => {
    const { service, queueAdd, removeStale } = build({ created: true, staleState: 'failed' });
    await service.create(DTO, API);
    expect(removeStale).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it('getStatus returns the run status for the owner', async () => {
    const run: AiSearchRunView = {
      id: 'run-1',
      ownerId: 'user-A',
      status: 'partial',
      progress: { phase: 'done', percent: 100 },
      captureCount: 2,
    };
    const { service } = build({ run });
    const res = await service.getStatus('run-1', SESSION_A);
    expect(res).toEqual({
      jobId: 'run-1',
      status: 'partial',
      progress: { phase: 'done', percent: 100 },
      captureCount: 2,
    });
  });

  it('getStatus throws 404 for an unknown run', async () => {
    const { service } = build({ run: null });
    await expect(service.getStatus('run-x', API)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getStatus throws 404 for a non-owner session (does not leak existence)', async () => {
    const run: AiSearchRunView = {
      id: 'run-1',
      ownerId: 'user-A',
      status: 'completed',
      progress: {},
      captureCount: 1,
    };
    const { service } = build({ run });
    await expect(service.getStatus('run-1', SESSION_B)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getRunRef returns {runId,status} for the owner, null for unknown/non-owner', async () => {
    const run: AiSearchRunView = {
      id: 'run-1',
      ownerId: 'user-A',
      status: 'running',
      progress: {},
      captureCount: null,
    };
    expect(await build({ run }).service.getRunRef('run-1', SESSION_A)).toEqual({
      runId: 'run-1',
      status: 'running',
    });
    expect(await build({ run }).service.getRunRef('run-1', SESSION_B)).toBeNull();
    expect(await build({ run: null }).service.getRunRef('run-x', API)).toBeNull();
  });

  // T15.8a（#678 G1）：Option A additive link → keyword-analysis（owner-verify、created 才落、不入 idempotency key）。
  it('links analysisId to the run (persists keywordAnalysisId) after owner-verify', async () => {
    const { service, createRun, findAnalysisOwner } = build({
      created: true,
      analysisOwner: { ownerId: 'user-A' }, // owned by SESSION_A
    });
    await service.create({ ...DTO, analysisId: ANALYSIS_ID }, SESSION_A);
    expect(findAnalysisOwner).toHaveBeenCalledWith(ANALYSIS_ID);
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({ keywordAnalysisId: ANALYSIS_ID }),
    );
  });

  it('links to a shared (null-owner) analysis for a session actor', async () => {
    const { service, createRun } = build({ created: true, analysisOwner: { ownerId: null } });
    await service.create({ ...DTO, analysisId: ANALYSIS_ID }, SESSION_A);
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({ keywordAnalysisId: ANALYSIS_ID }),
    );
  });

  it('does not link (keywordAnalysisId=null) when analysisId is omitted — standalone, backward compatible (FR-41)', async () => {
    const { service, createRun, findAnalysisOwner } = build({ created: true });
    await service.create(DTO, API);
    expect(findAnalysisOwner).not.toHaveBeenCalled(); // no analysis lookup on the standalone path
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({ keywordAnalysisId: null }));
  });

  it('rejects linking an analysis the session actor does not own → 404 (no existence leak, S8)', async () => {
    const { service, createRun } = build({
      created: true,
      analysisOwner: { ownerId: 'user-A' }, // owned by A, actor is B
    });
    await expect(
      service.create({ ...DTO, analysisId: ANALYSIS_ID }, SESSION_B),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(createRun).not.toHaveBeenCalled(); // fail fast, no run created
  });

  it('rejects linking an unknown analysis → 404', async () => {
    const { service } = build({ created: true, analysisOwner: null });
    await expect(
      service.create({ ...DTO, analysisId: ANALYSIS_ID }, SESSION_A),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
