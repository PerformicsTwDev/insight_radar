import type { TestingModuleBuilder } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import { AiSearchProcessor } from 'src/ai-search/ai-search.processor';
import { CustomClassifyAssignProcessor } from 'src/custom-classify/custom-classify-assign.processor';
import { JourneyProcessor } from 'src/journey/journey.processor';
import {
  AI_SEARCH_JOB_EVENTS_CONNECTION,
  AI_SEARCH_QUEUE_EVENTS,
} from 'src/queue/ai-search-job-events.constants';
import {
  CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION,
  CUSTOM_CLASSIFY_QUEUE_EVENTS,
} from 'src/queue/custom-classify-job-events.constants';
import {
  JOURNEY_JOB_EVENTS_CONNECTION,
  JOURNEY_QUEUE_EVENTS,
} from 'src/queue/journey-job-events.constants';
import {
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from 'src/queue/topic-job-events.constants';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';

/** Quiet stub for a BullMQ `QueueEvents` consumer: no-op listener + resolvable close (drain-safe). */
const quietQueueEvents = () => ({ on: () => undefined, close: () => Promise.resolve() });

/**
 * Apply the identical "secondary background-worker" DI overrides that every endpoint e2e spec shares
 * verbatim (M14-R7/#583 [12]): the topics / journey / custom-classify / ai-search / tracking processors,
 * their `QueueEvents` consumers, and their job-events Redis connections. None of these workers are
 * exercised by endpoint e2e specs, but `AppModule` wires them, so they must be neutralised — in-memory
 * `ioredis-mock` connections + no-op processors/consumers — or the app boots real Redis-backed workers
 * and SSE consumers (ECONNREFUSED on CI). Each spec keeps its OWN primary keyword-analysis
 * queue/connection/processor, `PrismaService`, and endpoint-specific overrides.
 *
 * Returns the same builder for continued chaining, so a spec reads:
 * `overrideBackgroundWorkers(Test.createTestingModule({ imports: [AppModule] })).overrideProvider(...)`.
 */
export function overrideBackgroundWorkers(builder: TestingModuleBuilder): TestingModuleBuilder {
  return builder
    .overrideProvider(TOPIC_JOB_EVENTS_CONNECTION)
    .useValue(new RedisMock())
    .overrideProvider(TOPIC_QUEUE_EVENTS)
    .useValue(quietQueueEvents())
    .overrideProvider(JOURNEY_JOB_EVENTS_CONNECTION)
    .useValue(new RedisMock())
    .overrideProvider(JOURNEY_QUEUE_EVENTS)
    .useValue(quietQueueEvents())
    .overrideProvider(JourneyProcessor)
    .useValue({})
    .overrideProvider(CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION)
    .useValue(new RedisMock())
    .overrideProvider(CUSTOM_CLASSIFY_QUEUE_EVENTS)
    .useValue(quietQueueEvents())
    .overrideProvider(CustomClassifyAssignProcessor)
    .useValue({})
    .overrideProvider(AI_SEARCH_JOB_EVENTS_CONNECTION)
    .useValue(new RedisMock())
    .overrideProvider(AI_SEARCH_QUEUE_EVENTS)
    .useValue(quietQueueEvents())
    .overrideProvider(AiSearchProcessor)
    .useValue({})
    .overrideProvider(TopicClusterProcessor)
    .useValue({})
    .overrideProvider(TrackingRefreshProcessor)
    .useValue({});
}
