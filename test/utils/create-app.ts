import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION } from 'src/queue/queue.constants';

/** 假 QueueEvents：避免真 bullmq QueueEvents 的阻塞 XREAD 連線（無 Redis → Jest hang）。 */
const fakeQueueEvents = { on: () => undefined, close: () => Promise.resolve() };

/**
 * 為 e2e 測試啟動完整 Nest app，**鏡像 `src/main.ts` 的 bootstrap**
 * （共用 `configureApp`：全域 `/api/v1` 前綴、`/health` 排除，保證測試與正式啟動不漂移）。
 *
 * 預設 hermetic：以 in-memory `ioredis-mock` 取代 BullMQ 連線，並 stub `KeywordAnalysisProcessor`
 * （否則 `@nestjs/bullmq` explorer 會起真 Worker 去 poll Redis，在無 Redis 的 CI 噴 async
 * ECONNREFUSED → node 22 上「Cannot log after tests are done」suite fail）。
 *
 * 呼叫端負責在 `afterAll` 收掉 `await app.close()`（TC-26，避免 Jest hang）。
 */
export async function createTestApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(BULL_CONNECTION)
    .useValue(new RedisMock())
    .overrideProvider(JOB_EVENTS_CONNECTION)
    .useValue(new RedisMock())
    .overrideProvider(JOB_QUEUE_EVENTS)
    .useValue(fakeQueueEvents)
    .overrideProvider(KeywordAnalysisProcessor)
    .useValue({})
    .overrideProvider(TopicClusterProcessor)
    .useValue({})
    .compile();

  const app: INestApplication<App> = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
