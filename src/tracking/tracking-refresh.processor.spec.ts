import type { ConfigType } from '@nestjs/config';
import type { Job } from 'bullmq';
import type { trackingConfig } from '../config/tracking.config';
import type { PrismaService } from '../prisma/prisma.service';
import type { VolumeRefreshService } from './volume-refresh.service';
import {
  SCHEDULED_REFRESH_JOB,
  TRACKING_REFRESH_SCHEDULER_ID,
  TrackingRefreshProcessor,
  type TrackingRefreshJobPayload,
} from './tracking-refresh.processor';

interface Deps {
  refreshList: jest.Mock<Promise<void>, [string]>;
  findMany: jest.Mock<Promise<Array<{ id: string }>>, []>;
  upsertJobScheduler: jest.Mock;
}

function makeProcessor(refreshCron = '0 3 * * *'): {
  processor: TrackingRefreshProcessor;
  deps: Deps;
} {
  const deps: Deps = {
    refreshList: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    findMany: jest.fn<Promise<Array<{ id: string }>>, []>(),
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
  };
  const queue = {
    upsertJobScheduler: deps.upsertJobScheduler,
  } as unknown as import('bullmq').Queue;
  const volumeRefresh = { refreshList: deps.refreshList } as unknown as VolumeRefreshService;
  const prisma = { trackingList: { findMany: deps.findMany } } as unknown as PrismaService;
  const config = { refreshCron } as ConfigType<typeof trackingConfig>;
  const processor = new TrackingRefreshProcessor(queue, volumeRefresh, prisma, config);
  return { processor, deps };
}

/** 建 job（listId 有值＝手動；無值＝排程）。 */
function job(data: TrackingRefreshJobPayload = {}): Job<TrackingRefreshJobPayload> {
  return { data } as Job<TrackingRefreshJobPayload>;
}

interface FakeWorker {
  run: jest.Mock;
  close: jest.Mock;
}

/** 掛上 WorkerHost backing `_worker` 替身（`this.worker` getter 在未初始化時擲錯——生產由 BullExplorer 建）。 */
function attachWorker(
  processor: TrackingRefreshProcessor,
  run: jest.Mock = jest.fn().mockResolvedValue(undefined),
): FakeWorker {
  const worker: FakeWorker = { run, close: jest.fn().mockResolvedValue(undefined) };
  (processor as unknown as { _worker: FakeWorker })._worker = worker;
  return worker;
}

describe('TC-65: TrackingRefreshProcessor (T11.6 · FR-29 AC-29.2/29.5 · NFR-16)', () => {
  describe('scheduled job — enumerate all lists (AC-29.2)', () => {
    it('refreshes every tracking list once (each under its own geo/language via refreshList)', async () => {
      const { processor, deps } = makeProcessor();
      deps.findMany.mockResolvedValue([{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }]);

      const result = await processor.process(job());

      expect(result).toEqual({ total: 3, refreshed: 3, failed: 0 });
      expect(deps.refreshList.mock.calls.map((c) => c[0])).toEqual(['l1', 'l2', 'l3']);
      // 排程 job 不帶 listId → 遍歷全部（findMany），不假設呼叫端傳清單。
      expect(deps.findMany).toHaveBeenCalledTimes(1);
    });

    it('empty list set → no refresh, zero summary', async () => {
      const { processor, deps } = makeProcessor();
      deps.findMany.mockResolvedValue([]);

      const result = await processor.process(job());

      expect(result).toEqual({ total: 0, refreshed: 0, failed: 0 });
      expect(deps.refreshList).not.toHaveBeenCalled();
    });

    it('partial failure of one list does NOT abort the others (log/continue, AC-29.5)', async () => {
      const { processor, deps } = makeProcessor();
      deps.findMany.mockResolvedValue([{ id: 'l1' }, { id: 'boom' }, { id: 'l3' }]);
      deps.refreshList.mockImplementation((listId: string) =>
        listId === 'boom'
          ? Promise.reject(new Error('ads boom (retries exhausted)'))
          : Promise.resolve(undefined),
      );

      const result = await processor.process(job());

      // 整批不失敗；失敗一個只記數，其餘照常刷新。
      expect(result).toEqual({ total: 3, refreshed: 2, failed: 1 });
      expect(deps.refreshList.mock.calls.map((c) => c[0])).toEqual(['l1', 'boom', 'l3']);
    });
  });

  describe('manual job — single list (AC-29.6)', () => {
    it('refreshes only the given list; does not enumerate all lists', async () => {
      const { processor, deps } = makeProcessor();

      const result = await processor.process(job({ listId: 'only-this' }));

      expect(result).toEqual({ total: 1, refreshed: 1, failed: 0 });
      expect(deps.refreshList).toHaveBeenCalledTimes(1);
      expect(deps.refreshList).toHaveBeenCalledWith('only-this');
      expect(deps.findMany).not.toHaveBeenCalled();
    });

    it('a failing single manual refresh is contained (failed=1, no throw)', async () => {
      const { processor, deps } = makeProcessor();
      deps.refreshList.mockRejectedValue(new Error('list vanished'));

      const result = await processor.process(job({ listId: 'gone' }));

      expect(result).toEqual({ total: 1, refreshed: 0, failed: 1 });
    });
  });

  describe('repeatable scheduler registration + worker start (AC-29.2)', () => {
    it('onApplicationBootstrap upserts a job scheduler with the configured cron and starts the worker', async () => {
      const { processor, deps } = makeProcessor('0 5 * * *');
      const worker = attachWorker(processor);

      await processor.onApplicationBootstrap();

      expect(deps.upsertJobScheduler).toHaveBeenCalledTimes(1);
      const [schedulerId, repeatOpts, template] = deps.upsertJobScheduler.mock.calls[0] as [
        string,
        { pattern: string },
        { name: string },
      ];
      expect(schedulerId).toBe(TRACKING_REFRESH_SCHEDULER_ID);
      expect(repeatOpts).toEqual({ pattern: '0 5 * * *' });
      expect(template.name).toBe(SCHEDULED_REFRESH_JOB);
      // autorun:false → bootstrap 才啟動 worker（避免 ioredis-mock busy-loop 在測試卡死，同 KW/Topic processor）。
      expect(worker.run).toHaveBeenCalledTimes(1);
    });

    it('scheduler registration failure does not crash bootstrap and still starts the worker (best-effort)', async () => {
      const { processor, deps } = makeProcessor();
      const worker = attachWorker(processor);
      deps.upsertJobScheduler.mockRejectedValue(new Error('redis://u:s3cr3t@h:6379 down'));

      await expect(processor.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(worker.run).toHaveBeenCalledTimes(1); // 排程註冊失敗仍啟動 worker（處理手動刷新）
    });

    it('a worker.run() rejection does not crash bootstrap (logs scrubbed)', async () => {
      const { processor } = makeProcessor();
      attachWorker(
        processor,
        jest.fn().mockRejectedValue(new Error('boot: redis://u:s3cr3t@h down')),
      );

      await expect(processor.onApplicationBootstrap()).resolves.toBeUndefined();
    });
  });

  describe('graceful shutdown (NFR-9)', () => {
    it('onModuleDestroy drains the worker; no-op when no worker exists', async () => {
      const { processor } = makeProcessor();
      const worker = attachWorker(processor);

      await processor.onModuleDestroy();
      expect(worker.close).toHaveBeenCalledTimes(1);

      const fresh = makeProcessor().processor;
      await expect(fresh.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
