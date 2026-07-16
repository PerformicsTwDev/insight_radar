import { NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from '../common/authenticated-user';
import type { PrismaService } from '../prisma/prisma.service';
import { MANUAL_REFRESH_JOB } from './tracking-refresh.processor';
import { TrackingRefreshService, manualRefreshJobId } from './tracking-refresh.service';

const OWNER_A: AuthenticatedUser = { kind: 'session', id: 'owner-a', email: 'a@example.com' };
const OWNER_B: AuthenticatedUser = { kind: 'session', id: 'owner-b', email: 'b@example.com' };
const MACHINE: AuthenticatedUser = { kind: 'apiKey' };

interface Deps {
  add: jest.Mock;
  findUnique: jest.Mock;
}

function makeService(): { service: TrackingRefreshService; deps: Deps } {
  const deps: Deps = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    findUnique: jest.fn(),
  };
  const queue = { add: deps.add } as unknown as Queue;
  const prisma = { trackingList: { findUnique: deps.findUnique } } as unknown as PrismaService;
  return { service: new TrackingRefreshService(queue, prisma), deps };
}

describe('TC-65: TrackingRefreshService.enqueueManualRefresh (T11.6 · FR-29 AC-29.6 · FR-27)', () => {
  it('owner → enqueues a single-flight one-off refresh job and returns a minimal 202 body', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue({ id: 'list-1', ownerId: 'owner-a' });

    const result = await service.enqueueManualRefresh('list-1', OWNER_A);

    expect(result).toEqual({ status: 'queued', listId: 'list-1' });
    expect(deps.add).toHaveBeenCalledTimes(1);
    const [name, payload, opts] = deps.add.mock.calls[0] as [
      string,
      { listId: string },
      { jobId: string; removeOnComplete: boolean; removeOnFail: boolean },
    ];
    expect(name).toBe(MANUAL_REFRESH_JOB);
    expect(payload).toEqual({ listId: 'list-1' });
    // per-list single-flight：jobId 由 listId 導出（BullMQ 對既有 jobId 不重複入列）；removeOnComplete/Fail
    // 讓 job 完成後釋放該 jobId，下一次手動刷新可再入列（否則永久卡在首個已完成 job）。
    expect(opts.jobId).toBe(manualRefreshJobId('list-1'));
    expect(opts.removeOnComplete).toBe(true);
    expect(opts.removeOnFail).toBe(true);
  });

  it('shares a null-owner list (owner-scope: session sees shared) → enqueues', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue({ id: 'list-shared', ownerId: null });

    await expect(service.enqueueManualRefresh('list-shared', OWNER_A)).resolves.toEqual({
      status: 'queued',
      listId: 'list-shared',
    });
    expect(deps.add).toHaveBeenCalledTimes(1);
  });

  it('apiKey machine actor is not owner-filtered → enqueues (AC-27.5)', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue({ id: 'list-1', ownerId: 'owner-a' });

    await expect(service.enqueueManualRefresh('list-1', MACHINE)).resolves.toEqual({
      status: 'queued',
      listId: 'list-1',
    });
    expect(deps.add).toHaveBeenCalledTimes(1);
  });

  it('non-owner session → 404 and does NOT enqueue (owner-scope enforced in service, FR-27)', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue({ id: 'list-1', ownerId: 'owner-a' });

    await expect(service.enqueueManualRefresh('list-1', OWNER_B)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(deps.add).not.toHaveBeenCalled();
  });

  it('missing list → 404 (indistinguishable from unauthorized) and does NOT enqueue', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(null);

    await expect(service.enqueueManualRefresh('ghost', OWNER_A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(deps.add).not.toHaveBeenCalled();
  });
});
