import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import { CacheService } from 'src/cache/cache.service';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import { JourneyProcessor } from 'src/journey/journey.processor';
import {
  CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION,
  CUSTOM_CLASSIFY_QUEUE_EVENTS,
} from 'src/queue/custom-classify-job-events.constants';
import { CustomClassifyAssignProcessor } from 'src/custom-classify/custom-classify-assign.processor';
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import {
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from 'src/queue/topic-job-events.constants';
import {
  JOURNEY_JOB_EVENTS_CONNECTION,
  JOURNEY_QUEUE_EVENTS,
} from 'src/queue/journey-job-events.constants';
import { BULL_CONNECTION } from 'src/queue/queue.constants';

/**
 * TC-26（NFR-9 graceful shutdown）：`app.close()` 須收回所有外部連線（Queue / QueueEvents / cache）
 * 且**不 hang**，且 lifecycle 順序正確——**先停 worker 收 job（drain in-flight）、再關相依連線**。
 * 以可監看的 ioredis-mock 連線替身驗證 lifecycle 真的觸發 quit/close/disconnect。
 *
 * Worker 關閉路徑：`KeywordAnalysisProcessor.onModuleDestroy → worker.close()`（T7.5）。因 `KeywordAnalysisModule`
 * 相依 `QueueModule`/`JobEventsModule`，Nest 以**反相依序**先銷毀本模組（→ processor drain）、後銷毀連線模組
 * （→ `BullConnectionLifecycle.quit`）。此處以 processor 替身的 `onModuleDestroy` + 連線 `quit` 的
 * `invocationCallOrder` 驗證此序（drain 早於 quit）。
 *
 * 此處 **不**起真 Worker：真 BullMQ Worker over ioredis-mock 的阻塞輪詢在 **Linux CI 上 busy-loop 卡住
 * event loop → 整個測試程序 hang**（macOS 本機可過、Linux CI 會掛，屬 ioredis-mock 阻塞命令的平台差異）。
 * 真 worker 對 in-flight job 的排空由 processor 單元測（`worker.close` 被 await）+ 此序驗證結構性覆蓋；
 * 真 Redis 端到端 drain 依 T3.11 policy 不納 CI（busy-loop 風險）。
 */
describe('Graceful shutdown (e2e, TC-26 / NFR-9)', () => {
  it('drains the worker before quitting connections, closes all, and does not hang', async () => {
    const bullConnection = new RedisMock();
    const jobEventsConnection = new RedisMock();
    const bullQuit = jest.spyOn(bullConnection, 'quit');
    const jobEventsQuit = jest.spyOn(jobEventsConnection, 'quit');
    const queueEventsClose = jest.fn().mockResolvedValue(undefined);
    // processor 替身的 drain hook：其 onModuleDestroy 必在連線 quit 前被呼叫（反相依序）。
    const workerDrain = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BULL_CONNECTION)
      .useValue(bullConnection)
      .overrideProvider(JOB_EVENTS_CONNECTION)
      .useValue(jobEventsConnection)
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: queueEventsClose })
      .overrideProvider(TOPIC_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(TOPIC_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      // 替身 processor → 不起真 Worker（避免 ioredis-mock 阻塞輪詢在 Linux CI 卡住）；保留 onModuleDestroy
      // 以驗證「drain 早於連線 quit」的 lifecycle 序（真 processor 於此 hook 內 await worker.close，見單元測）。
      .overrideProvider(KeywordAnalysisProcessor)
      .useValue({ onModuleDestroy: workerDrain })
      .overrideProvider(JOURNEY_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOURNEY_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(JourneyProcessor)
      .useValue({})
      .overrideProvider(CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(CUSTOM_CLASSIFY_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(CustomClassifyAssignProcessor)
      .useValue({})
      .overrideProvider(TopicClusterProcessor)
      .useValue({})
      .overrideProvider(TrackingRefreshProcessor)
      .useValue({})
      .compile();

    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const cacheDestroy = jest.spyOn(app.get(CacheService), 'onModuleDestroy');

    await app.close(); // 不 hang（在 Jest 預設 timeout 內完成）

    expect(workerDrain).toHaveBeenCalled(); // KeywordAnalysisProcessor 於 shutdown 排空 worker（T7.5）
    expect(bullQuit).toHaveBeenCalled(); // BullConnectionLifecycle 收回 Queue 連線
    expect(jobEventsQuit).toHaveBeenCalled(); // JobEventsConnectionLifecycle 收回 QueueEvents 連線
    expect(queueEventsClose).toHaveBeenCalled(); // JobEventsService 關閉 QueueEvents
    expect(cacheDestroy).toHaveBeenCalled(); // CacheService 收回 cache 連線

    // 順序（NFR-9 / T7.5）：worker drain 必早於 Queue/QueueEvents 連線 quit，否則 in-flight job 會在
    // 連線已關後才排空 → 連線洩漏 / 寫入失敗。invocationCallOrder 為 jest 全域單調呼叫序。
    const drainOrder = workerDrain.mock.invocationCallOrder[0];
    expect(drainOrder).toBeLessThan(bullQuit.mock.invocationCallOrder[0]);
    expect(drainOrder).toBeLessThan(jobEventsQuit.mock.invocationCallOrder[0]);
  });
});
