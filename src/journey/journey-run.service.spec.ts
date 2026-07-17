import {
  ConflictException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from '../common/authenticated-user';
import type { PrismaService } from '../prisma';
import { JourneyRunRepository } from './journey-run.repository';
import { JourneyRunService, type JourneyRunConfig } from './journey-run.service';

const API: AuthenticatedUser = { kind: 'apiKey' };
const SESSION_A: AuthenticatedUser = { kind: 'session', id: 'user-A', email: 'a@x.io' };

const CONFIG: JourneyRunConfig = {
  schemaVersion: 'v1',
  deployment: 'gpt-4o-mini',
  maxKeywords: 5000,
  jobAttempts: 5,
  jobBackoffMs: 3000,
  jobBackoffJitter: 0.2,
};

interface AnalysisOver {
  ownerId?: string | null;
  status?: string;
  resultSnapshot?: { id: string; checksum: string } | null;
}
function analysisRow(over: AnalysisOver = {}) {
  return {
    id: 'an-1',
    ownerId: over.ownerId ?? null,
    status: over.status ?? 'completed',
    resultSnapshot:
      over.resultSnapshot === undefined ? { id: 'snap-1', checksum: 'chk-1' } : over.resultSnapshot,
    params: {},
  };
}

interface BuildOpts {
  analysis?: ReturnType<typeof analysisRow> | null;
  keywordCount?: number;
  created?: boolean;
  latest?: {
    id: string;
    snapshotId: string;
    status: string;
    progress: unknown;
    keywordCount: number | null;
  } | null;
  enqueueError?: Error;
}
function build(opts: BuildOpts = {}) {
  const queueAdd = jest.fn((_name: string, _data: unknown, _opts: unknown) =>
    opts.enqueueError ? Promise.reject(opts.enqueueError) : Promise.resolve(undefined),
  );
  const queueGetJob = jest.fn<Promise<unknown>, [string]>(() => Promise.resolve(null));
  const queue = { add: queueAdd, getJob: queueGetJob } as unknown as Queue;
  const findUnique = jest.fn(() =>
    Promise.resolve(opts.analysis === undefined ? analysisRow() : opts.analysis),
  );
  const count = jest.fn(() => Promise.resolve(opts.keywordCount ?? 10));
  const del = jest.fn(() => Promise.resolve(undefined));
  const prisma = {
    keywordAnalysis: { findUnique },
    snapshotRow: { count },
    journeyRun: { delete: del },
  } as unknown as PrismaService;
  const createRun = jest.fn(() =>
    Promise.resolve({ runId: 'run-1', created: opts.created ?? true }),
  );
  const findLatest = jest.fn(() => Promise.resolve(opts.latest ?? null));
  const markStatus = jest.fn<Promise<void>, [string, string, { error?: string }?]>(() =>
    Promise.resolve(),
  );
  const repo = {
    createRun,
    findLatestRunByAnalysis: findLatest,
    markStatus,
  } as unknown as JourneyRunRepository;
  const service = new JourneyRunService(queue, prisma, repo, CONFIG);
  return { service, queueAdd, queueGetJob, createRun, findLatest, markStatus, del };
}

/** BullMQ Job 替身：只回 getState + remove（enqueueReusingJobId 用到的介面）。 */
function fakeJob(state: string) {
  return {
    getState: jest.fn<Promise<string>, []>(() => Promise.resolve(state)),
    remove: jest.fn<Promise<void>, []>(() => Promise.resolve()),
  };
}

describe('JourneyRunService (T12.6 / FR-33 / AC-33.6)', () => {
  describe('create (enqueue-only)', () => {
    it('202: creates a run and enqueues once (jobId = runId), returns { journeyJobId }', async () => {
      const { service, queueAdd, createRun } = build();
      const out = await service.create('an-1', API);
      expect(out).toEqual({ journeyJobId: 'run-1' });
      expect(createRun).toHaveBeenCalledTimes(1);
      expect(queueAdd).toHaveBeenCalledTimes(1);
      expect(queueAdd.mock.calls[0][2]).toMatchObject({ jobId: 'run-1', attempts: 5 });
    });

    it('idempotency hit (created=false) → does NOT enqueue again', async () => {
      const { service, queueAdd } = build({ created: false });
      const out = await service.create('an-1', API);
      expect(out).toEqual({ journeyJobId: 'run-1' });
      expect(queueAdd).not.toHaveBeenCalled();
    });

    it('unknown analysis → 404 (no run, no enqueue)', async () => {
      const { service, createRun } = build({ analysis: null });
      await expect(service.create('missing', API)).rejects.toBeInstanceOf(NotFoundException);
      expect(createRun).not.toHaveBeenCalled();
    });

    it('cross-owner session actor → 404 (owner single-point, IDOR)', async () => {
      const { service, createRun } = build({ analysis: analysisRow({ ownerId: 'user-B' }) });
      await expect(service.create('an-1', SESSION_A)).rejects.toBeInstanceOf(NotFoundException);
      expect(createRun).not.toHaveBeenCalled();
    });

    it('snapshot not ready (running) → 425 Too Early', async () => {
      const { service } = build({
        analysis: analysisRow({ status: 'running', resultSnapshot: null }),
      });
      const err = await service.create('an-1', API).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(425);
    });

    it('failed analysis (no usable snapshot) → 409', async () => {
      const { service } = build({
        analysis: analysisRow({ status: 'failed', resultSnapshot: null }),
      });
      await expect(service.create('an-1', API)).rejects.toBeInstanceOf(ConflictException);
    });

    it('#484 input bound: snapshot keyword count over max → 413', async () => {
      const { service, createRun } = build({ keywordCount: 5001 });
      await expect(service.create('an-1', API)).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(createRun).not.toHaveBeenCalled();
    });

    it('enqueue failure → marks the run failed (NOT delete) + rethrow (M12-R7)', async () => {
      const { service, markStatus, del } = build({ enqueueError: new Error('redis down') });
      await expect(service.create('an-1', API)).rejects.toThrow('redis down');
      expect(markStatus).toHaveBeenCalledTimes(1);
      const [runId, status, extra] = markStatus.mock.calls[0] as [
        string,
        string,
        { error: string },
      ];
      expect(runId).toBe('run-1');
      expect(status).toBe('failed');
      expect(extra.error).toContain('enqueue failed');
      expect(del).not.toHaveBeenCalled(); // no orphan-run deletion
    });

    it('fresh create (no stale job) → enqueues without removing (M12-R1)', async () => {
      const { service, queueGetJob, queueAdd } = build();
      await service.create('an-1', API);
      expect(queueGetJob).toHaveBeenCalledWith('run-1');
      expect(queueAdd).toHaveBeenCalledTimes(1);
    });

    it('reset reuse: removes a stale NON-active job then re-enqueues same jobId (M12-R1)', async () => {
      const { service, queueGetJob, queueAdd } = build();
      const stale = fakeJob('failed'); // reset-run's old job sits in the failed set (not locked)
      queueGetJob.mockResolvedValueOnce(stale);
      await service.create('an-1', API);
      expect(stale.remove).toHaveBeenCalledTimes(1);
      expect(queueAdd).toHaveBeenCalledTimes(1);
    });

    it('reset with an ACTIVE prior job → 503 + mark failed, does NOT silently no-op enqueue (#506 blocker)', async () => {
      const { service, queueGetJob, queueAdd, markStatus } = build();
      const active = fakeJob('active'); // old attempt still holds the lock → remove()=0, add() would dedup no-op
      queueGetJob.mockResolvedValueOnce(active);
      await expect(service.create('an-1', API)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(active.remove).not.toHaveBeenCalled();
      expect(queueAdd).not.toHaveBeenCalled(); // must NOT proceed to a no-op add
      expect(markStatus).toHaveBeenCalledTimes(1); // run kept reset-eligible (failed), not stuck at queued
      expect(markStatus.mock.calls[0][1]).toBe('failed');
    });

    it('accepts a partial analysis (it has a usable snapshot) → 202', async () => {
      const { service, queueAdd } = build({ analysis: analysisRow({ status: 'partial' }) });
      expect(await service.create('an-1', API)).toEqual({ journeyJobId: 'run-1' });
      expect(queueAdd).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStatus', () => {
    it('no run → 404', async () => {
      const { service } = build({ latest: null });
      await expect(service.getStatus('an-1', API)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the latest run status', async () => {
      const { service } = build({
        latest: {
          id: 'run-1',
          snapshotId: 'snap-1',
          status: 'completed',
          progress: { percent: 100 },
          keywordCount: 12,
        },
      });
      const out = await service.getStatus('an-1', API);
      expect(out).toEqual({
        journeyJobId: 'run-1',
        status: 'completed',
        progress: { percent: 100 },
        keywordCount: 12,
      });
    });

    it('cross-owner → 404', async () => {
      const { service } = build({ analysis: analysisRow({ ownerId: 'user-B' }) });
      await expect(service.getStatus('an-1', SESSION_A)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getRunRef (SSE)', () => {
    it('cross-owner → null (no throw, empty stream)', async () => {
      const { service } = build({ analysis: analysisRow({ ownerId: 'user-B' }) });
      expect(await service.getRunRef('an-1', SESSION_A)).toBeNull();
    });

    it('owner with a run → { runId, status }', async () => {
      const { service } = build({
        latest: {
          id: 'run-1',
          snapshotId: 'snap-1',
          status: 'running',
          progress: {},
          keywordCount: null,
        },
      });
      expect(await service.getRunRef('an-1', API)).toEqual({ runId: 'run-1', status: 'running' });
    });

    it('unknown analysis → null', async () => {
      const { service } = build({ analysis: null });
      expect(await service.getRunRef('missing', API)).toBeNull();
    });

    it('owner ok but no run yet → null', async () => {
      const { service } = build({ latest: null }); // analysis present (owner ok), no run
      expect(await service.getRunRef('an-1', API)).toBeNull();
    });
  });
});
