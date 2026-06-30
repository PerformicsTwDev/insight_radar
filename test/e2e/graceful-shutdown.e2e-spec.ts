import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import { CacheService } from 'src/cache/cache.service';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION } from 'src/queue/queue.constants';

/**
 * TC-26（NFR-9 graceful shutdown）：`app.close()` 須收回所有外部連線（Queue / QueueEvents / cache）
 * 且**不 hang**。以可監看的 ioredis-mock 連線替身驗證 lifecycle 真的觸發 quit/close/disconnect。
 *
 * Worker 關閉路徑由 `@nestjs/bullmq` explorer 的 `onApplicationShutdown → worker.close()` 提供（已查證），
 * 此處 **不**起真 Worker：真 BullMQ Worker over ioredis-mock 的阻塞輪詢在 **Linux CI 上 busy-loop 卡住
 * event loop → 整個測試程序 hang**（macOS 本機可過、Linux CI 會掛，屬 ioredis-mock 阻塞命令的平台差異）。
 * job 內 in-flight drain 的整合驗證留待 T7.5（真 Redis）。
 */
describe('Graceful shutdown (e2e, TC-26 / NFR-9)', () => {
  it('app.close() quits queue + job-events connections, disconnects cache, and does not hang', async () => {
    const bullConnection = new RedisMock();
    const jobEventsConnection = new RedisMock();
    const bullQuit = jest.spyOn(bullConnection, 'quit');
    const jobEventsQuit = jest.spyOn(jobEventsConnection, 'quit');
    const queueEventsClose = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BULL_CONNECTION)
      .useValue(bullConnection)
      .overrideProvider(JOB_EVENTS_CONNECTION)
      .useValue(jobEventsConnection)
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: queueEventsClose })
      // 空替身 processor → 不起真 Worker（避免 ioredis-mock 阻塞輪詢在 Linux CI 卡住）。
      .overrideProvider(KeywordAnalysisProcessor)
      .useValue({})
      .compile();

    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const cacheDestroy = jest.spyOn(app.get(CacheService), 'onModuleDestroy');

    await app.close(); // 不 hang（在 Jest 預設 timeout 內完成）

    expect(bullQuit).toHaveBeenCalled(); // BullConnectionLifecycle 收回 Queue 連線
    expect(jobEventsQuit).toHaveBeenCalled(); // JobEventsConnectionLifecycle 收回 QueueEvents 連線
    expect(queueEventsClose).toHaveBeenCalled(); // JobEventsService 關閉 QueueEvents
    expect(cacheDestroy).toHaveBeenCalled(); // CacheService 收回 cache 連線
  });
});
