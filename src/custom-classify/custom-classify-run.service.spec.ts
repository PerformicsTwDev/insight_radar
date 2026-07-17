import {
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from '../common/authenticated-user';
import type { PrismaService } from '../prisma';
import type { CustomClassifyRunRepository } from './custom-classify-run.repository';
import type { CustomLabel } from './custom-classify.schema';
import {
  CustomClassifyRunService,
  type CustomClassifyRunConfig,
} from './custom-classify-run.service';

const API_KEY_ACTOR: AuthenticatedUser = { kind: 'apiKey' };
const SESSION_A: AuthenticatedUser = { kind: 'session', id: 'user-A', email: 'a@x.com' };
const AN = 'an-1';
const CID = 'cid-1';
const LABELS: CustomLabel[] = [
  { label: 'transactional', description: 'buy' },
  { label: 'informational', description: 'research' },
];
const CONFIG: CustomClassifyRunConfig = {
  schemaVersion: 'v1',
  deployment: 'gpt-4o-mini',
  maxLabels: 12,
  maxKeywords: 5000,
  jobAttempts: 5,
  jobBackoffMs: 3000,
  jobBackoffJitter: 0.2,
};

function build(
  over: {
    classification?: unknown;
    owner?: unknown;
    keywordCount?: number;
    createRun?: { runId: string; created: boolean };
    latestRun?: unknown;
    enqueueRejects?: boolean;
  } = {},
) {
  const queueAdd = jest.fn<Promise<unknown>, [string, unknown, Record<string, unknown>]>(() =>
    over.enqueueRejects ? Promise.reject(new Error('redis down')) : Promise.resolve(undefined),
  );
  const queueGetJob = jest.fn<Promise<unknown>, [string]>(() => Promise.resolve(null));
  const queue = { add: queueAdd, getJob: queueGetJob } as unknown as Queue;

  const ccFindUnique = jest
    .fn()
    .mockResolvedValue(
      'classification' in over ? over.classification : { analysisId: AN, snapshotId: 'snap-1' },
    );
  const ccUpdate = jest.fn().mockResolvedValue({});
  const kaFindUnique = jest
    .fn()
    .mockResolvedValue('owner' in over ? over.owner : { ownerId: null });
  const srCount = jest.fn().mockResolvedValue(over.keywordCount ?? 10);
  const rsFindUniqueOrThrow = jest.fn().mockResolvedValue({ checksum: 'chk' });
  const ccrDelete = jest.fn().mockResolvedValue({});
  const prisma = {
    customClassification: { findUnique: ccFindUnique, update: ccUpdate },
    keywordAnalysis: { findUnique: kaFindUnique },
    snapshotRow: { count: srCount },
    resultSnapshot: { findUniqueOrThrow: rsFindUniqueOrThrow },
    customClassifyRun: { delete: ccrDelete },
  } as unknown as PrismaService;

  const createRun = jest
    .fn()
    .mockResolvedValue(over.createRun ?? { runId: 'run-1', created: true });
  const findLatestRunByClassification = jest.fn().mockResolvedValue(over.latestRun ?? null);
  const markStatus = jest
    .fn<Promise<void>, [string, string, { error?: string }?]>()
    .mockResolvedValue(undefined);
  const repo = {
    createRun,
    findLatestRunByClassification,
    markStatus,
  } as unknown as CustomClassifyRunRepository;

  const service = new CustomClassifyRunService(queue, prisma, repo, CONFIG);
  return {
    service,
    queueAdd,
    queueGetJob,
    ccUpdate,
    createRun,
    findLatestRunByClassification,
    markStatus,
    ccrDelete,
  };
}

/** BullMQ Job 替身：只回 getState + remove（enqueueReusingJobId 用到的介面）。 */
function fakeJob(state: string) {
  return {
    getState: jest.fn<Promise<string>, []>(() => Promise.resolve(state)),
    remove: jest.fn<Promise<void>, []>(() => Promise.resolve()),
  };
}

describe('CustomClassifyRunService (T12.8 / FR-34 / AC-34.2 / TC-70 部分)', () => {
  describe('create (enqueue-only)', () => {
    it('enqueues once and returns {jobId} on a fresh run; writes back the confirmed labels', async () => {
      const { service, queueAdd, ccUpdate, createRun } = build();
      const out = await service.create(AN, CID, LABELS, API_KEY_ACTOR);

      expect(out).toEqual({ jobId: 'run-1' });
      expect(createRun).toHaveBeenCalledTimes(1);
      expect(queueAdd).toHaveBeenCalledTimes(1);
      expect(queueAdd.mock.calls[0][2]).toMatchObject({ jobId: 'run-1', attempts: 5 });
      // HITL confirmation is written back to custom_classifications.
      expect(ccUpdate).toHaveBeenCalledWith({ where: { id: CID }, data: { labels: LABELS } });
    });

    it('does NOT enqueue again on an idempotency hit (created=false)', async () => {
      const { service, queueAdd } = build({ createRun: { runId: 'run-1', created: false } });
      const out = await service.create(AN, CID, LABELS, API_KEY_ACTOR);
      expect(out).toEqual({ jobId: 'run-1' });
      expect(queueAdd).not.toHaveBeenCalled();
    });

    it('rejects an empty confirmed-label set with 409 (cannot build enum); no run created', async () => {
      const { service, createRun } = build();
      await expect(service.create(AN, CID, [], API_KEY_ACTOR)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(createRun).not.toHaveBeenCalled();
    });

    it.each([['unclassified'], ['Unclassified'], ['  UNCLASSIFIED  ']])(
      'rejects the reserved sentinel label %p with 409 (defensive; would conflate the gap bucket, M12-R4)',
      async (reserved) => {
        const { service, createRun } = build();
        const labels = [{ label: reserved, description: 'x' }, ...LABELS];
        await expect(service.create(AN, CID, labels, API_KEY_ACTOR)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(createRun).not.toHaveBeenCalled();
      },
    );

    it('rejects a confirmed-label set over maxLabels with 413 (cost guard); no run created', async () => {
      const { service, createRun } = build();
      const tooMany = Array.from({ length: 13 }, (_, i) => ({
        label: `l${i}`,
        description: 'd',
      }));
      await expect(service.create(AN, CID, tooMany, API_KEY_ACTOR)).rejects.toBeInstanceOf(
        PayloadTooLargeException,
      );
      expect(createRun).not.toHaveBeenCalled();
    });

    it('rejects a snapshot over maxKeywords with 413 (cost guard); no run created', async () => {
      const { service, createRun } = build({ keywordCount: 5001 });
      await expect(service.create(AN, CID, LABELS, API_KEY_ACTOR)).rejects.toBeInstanceOf(
        PayloadTooLargeException,
      );
      expect(createRun).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown classification id', async () => {
      const { service, createRun } = build({ classification: null });
      await expect(service.create(AN, CID, LABELS, API_KEY_ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(createRun).not.toHaveBeenCalled();
    });

    it('returns 404 when the classification belongs to a different analysis (IDOR: :cid not under :id)', async () => {
      const { service } = build({
        classification: { analysisId: 'other-an', snapshotId: 'snap-1' },
      });
      await expect(service.create(AN, CID, LABELS, API_KEY_ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns 404 for a non-owner session actor (owner single point, not bypassable)', async () => {
      const { service, createRun } = build({ owner: { ownerId: 'user-B' } });
      await expect(service.create(AN, CID, LABELS, SESSION_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(createRun).not.toHaveBeenCalled();
    });

    it('marks the run failed (NOT delete) when enqueue fails, then rethrows (M12-R7: keep the run so a concurrent 202 jobId stays valid + it can be re-enqueued)', async () => {
      const { service, markStatus, ccrDelete } = build({ enqueueRejects: true });
      await expect(service.create(AN, CID, LABELS, API_KEY_ACTOR)).rejects.toThrow('redis down');
      expect(markStatus).toHaveBeenCalledTimes(1);
      const [runId, status, extra] = markStatus.mock.calls[0] as [
        string,
        string,
        { error: string },
      ];
      expect(runId).toBe('run-1');
      expect(status).toBe('failed');
      expect(extra.error).toContain('enqueue failed');
      expect(ccrDelete).not.toHaveBeenCalled(); // no orphan-run deletion
    });

    it('fresh create (no stale job) → enqueues without removing (M12-R1)', async () => {
      const { service, queueGetJob, queueAdd } = build();
      await service.create(AN, CID, LABELS, API_KEY_ACTOR);
      expect(queueGetJob).toHaveBeenCalledWith('run-1');
      expect(queueAdd).toHaveBeenCalledTimes(1);
    });

    it('reset reuse: removes a stale NON-active job then re-enqueues same jobId (M12-R1)', async () => {
      const { service, queueGetJob, queueAdd } = build();
      const stale = fakeJob('failed'); // reset-run's old job sits in the failed set (not locked)
      queueGetJob.mockResolvedValueOnce(stale);
      await service.create(AN, CID, LABELS, API_KEY_ACTOR);
      expect(stale.remove).toHaveBeenCalledTimes(1);
      expect(queueAdd).toHaveBeenCalledTimes(1);
    });

    it('reset with an ACTIVE prior job → 503 + mark failed, does NOT silently no-op enqueue (#506 blocker)', async () => {
      const { service, queueGetJob, queueAdd, markStatus } = build();
      const active = fakeJob('active'); // old attempt still holds the lock → remove()=0, add() would dedup no-op
      queueGetJob.mockResolvedValueOnce(active);
      await expect(service.create(AN, CID, LABELS, API_KEY_ACTOR)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(active.remove).not.toHaveBeenCalled();
      expect(queueAdd).not.toHaveBeenCalled(); // must NOT proceed to a no-op add
      expect(markStatus).toHaveBeenCalledTimes(1); // run kept reset-eligible (failed), not stuck at queued
      expect(markStatus.mock.calls[0][1]).toBe('failed');
    });
  });

  describe('getStatus', () => {
    it('returns the latest run status', async () => {
      const { service } = build({
        latestRun: {
          id: 'run-1',
          status: 'completed',
          progress: { phase: 'done' },
          keywordCount: 42,
        },
      });
      expect(await service.getStatus(AN, CID, API_KEY_ACTOR)).toEqual({
        jobId: 'run-1',
        status: 'completed',
        progress: { phase: 'done' },
        keywordCount: 42,
      });
    });

    it('returns 404 when there is no run', async () => {
      const { service } = build({ latestRun: null });
      await expect(service.getStatus(AN, CID, API_KEY_ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns 404 for a non-owner session actor', async () => {
      const { service } = build({ owner: { ownerId: 'user-B' } });
      await expect(service.getStatus(AN, CID, SESSION_A)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getRunRef (SSE)', () => {
    it('returns {runId,status} for the owner', async () => {
      const { service } = build({ latestRun: { id: 'run-1', status: 'running' } });
      expect(await service.getRunRef(AN, CID, API_KEY_ACTOR)).toEqual({
        runId: 'run-1',
        status: 'running',
      });
    });

    it('returns null when the owner has no run yet (owner passes, but no latest run)', async () => {
      const { service } = build({ latestRun: null });
      expect(await service.getRunRef(AN, CID, API_KEY_ACTOR)).toBeNull();
    });

    it('returns null (not an exception) for a non-owner session actor', async () => {
      const { service } = build({
        owner: { ownerId: 'user-B' },
        latestRun: { id: 'r', status: 'running' },
      });
      expect(await service.getRunRef(AN, CID, SESSION_A)).toBeNull();
    });

    it('returns null when the classification is not under the given analysis', async () => {
      const { service } = build({ classification: { analysisId: 'other-an' } });
      expect(await service.getRunRef(AN, CID, API_KEY_ACTOR)).toBeNull();
    });
  });
});
