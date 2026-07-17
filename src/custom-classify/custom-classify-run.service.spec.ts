import { ConflictException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
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
  const queue = { add: queueAdd } as unknown as Queue;

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
  const repo = {
    createRun,
    findLatestRunByClassification,
  } as unknown as CustomClassifyRunRepository;

  const service = new CustomClassifyRunService(queue, prisma, repo, CONFIG);
  return { service, queueAdd, ccUpdate, createRun, findLatestRunByClassification, ccrDelete };
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

    it('compensates by deleting the orphan run when enqueue fails, then rethrows', async () => {
      const { service, ccrDelete } = build({ enqueueRejects: true });
      await expect(service.create(AN, CID, LABELS, API_KEY_ACTOR)).rejects.toThrow('redis down');
      expect(ccrDelete).toHaveBeenCalledWith({ where: { id: 'run-1' } });
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
