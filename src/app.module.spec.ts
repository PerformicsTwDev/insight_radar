import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import { AppModule } from './app.module';
import { CustomClassifyAssignProcessor } from './custom-classify/custom-classify-assign.processor';
import { JourneyProcessor } from './journey/journey.processor';
import { KeywordAnalysisProcessor } from './keyword-analysis/keyword-analysis.processor';
import { TopicClusterProcessor } from './topics/topic-cluster.processor';
import { TrackingRefreshProcessor } from './tracking/tracking-refresh.processor';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from './queue/job-events.constants';
import {
  CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION,
  CUSTOM_CLASSIFY_QUEUE_EVENTS,
} from './queue/custom-classify-job-events.constants';
import {
  JOURNEY_JOB_EVENTS_CONNECTION,
  JOURNEY_QUEUE_EVENTS,
} from './queue/journey-job-events.constants';
import {
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from './queue/topic-job-events.constants';
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
      .overrideProvider(TOPIC_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOURNEY_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(TOPIC_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(JOURNEY_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(CUSTOM_CLASSIFY_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(KeywordAnalysisProcessor)
      .useValue({})
      .overrideProvider(TopicClusterProcessor)
      .useValue({})
      .overrideProvider(TrackingRefreshProcessor)
      .useValue({})
      .overrideProvider(JourneyProcessor)
      .useValue({})
      .overrideProvider(CustomClassifyAssignProcessor)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    expect(app).toBeDefined();
  });
});
