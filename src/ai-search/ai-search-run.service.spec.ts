import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from '../common/authenticated-user';
import type { CreateAiSearchAnalysisDto } from './ai-search.dto';
import { AiSearchRunRepository } from './ai-search-run.repository';
import { AiSearchRunService, type AiSearchRunConfig } from './ai-search-run.service';
import type { AiSearchRunView } from './ai-search-run.types';

const API: AuthenticatedUser = { kind: 'apiKey' };
const SESSION_A: AuthenticatedUser = { kind: 'session', id: 'user-A', email: 'a@x.io' };
const SESSION_B: AuthenticatedUser = { kind: 'session', id: 'user-B', email: 'b@x.io' };

const CONFIG: AiSearchRunConfig = {
  schemaVersion: 'ai-search-v1',
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

  const createRun = jest.fn(() =>
    Promise.resolve({ runId: opts.runId ?? 'run-1', created: opts.created ?? true }),
  );
  const findById = jest.fn(() => Promise.resolve(opts.run ?? null));
  const markStatus = jest.fn(() => Promise.resolve());
  const repo = { createRun, findById, markStatus } as unknown as AiSearchRunRepository;

  const service = new AiSearchRunService(queue, repo, CONFIG);
  return { service, queueAdd, queueGetJob, removeStale, createRun, findById, markStatus };
}

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
});
