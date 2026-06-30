import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import { AppModule } from './app.module';
import { KeywordAnalysisProcessor } from './keyword-analysis/keyword-analysis.processor';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from './queue/job-events.constants';
import { BULL_CONNECTION } from './queue/queue.constants';

describe('AppModule (smoke)', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('compiles and initialises the application context', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Hermetic boot with no real Redis: in-memory connection + stub the processor so the
      // @nestjs/bullmq explorer does not spin up a real Worker (which would poll Redis and
      // emit async ECONNREFUSED after the test — a CI race, seen on node 22).
      .overrideProvider(BULL_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(KeywordAnalysisProcessor)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    expect(app).toBeDefined();
  });
});
