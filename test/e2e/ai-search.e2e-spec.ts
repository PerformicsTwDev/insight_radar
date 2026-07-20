import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { AiSearchProcessor } from 'src/ai-search/ai-search.processor';
import { configureApp } from 'src/bootstrap';
import { CustomClassifyAssignProcessor } from 'src/custom-classify/custom-classify-assign.processor';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { PrismaService } from 'src/prisma';
import {
  AI_SEARCH_JOB_EVENTS_CONNECTION,
  AI_SEARCH_QUEUE_EVENTS,
} from 'src/queue/ai-search-job-events.constants';
import {
  CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION,
  CUSTOM_CLASSIFY_QUEUE_EVENTS,
} from 'src/queue/custom-classify-job-events.constants';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import {
  JOURNEY_JOB_EVENTS_CONNECTION,
  JOURNEY_QUEUE_EVENTS,
} from 'src/queue/journey-job-events.constants';
import { AI_SEARCH_QUEUE, BULL_CONNECTION } from 'src/queue/queue.constants';
import {
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from 'src/queue/topic-job-events.constants';
import { JourneyProcessor } from 'src/journey/journey.processor';
import { SERP_AI_PROVIDER } from 'src/serp/serpapi-ai.types';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';

const API_KEY = 'test-api-key'; // matches .env.test
const RID = '33333333-3333-3333-3333-333333333333'; // valid UUID (:id 經 ParseUUIDPipe)

/**
 * TC-77 (T14.6 · FR-41/AC-41.x): `POST /ai-search-analyses` 為 **enqueue-only、零外部呼叫**（p95<300ms）。
 * 以替身隔離：假 ai-search queue（getQueueToken）、ioredis-mock、SERP_AI_PROVIDER spy、假 prisma → 驗 202 只入列、
 * idempotency 命中回同 jobId、GET 狀態、未知→404、SSE 未知回空串流（不 hang）、DTO 400、401 無 key。合流/partial 於
 * integration（Testcontainers）驗（processor 於此 stub）。
 */
describe('POST/GET/SSE /ai-search-analyses (e2e, TC-77)', () => {
  let app: INestApplication<App>;
  let queueAdd: jest.Mock;
  let runFindUnique: jest.Mock;
  let runCreate: jest.Mock;
  let serpFetchAiOverviews: jest.Mock;
  let serpFetchAiModes: jest.Mock;
  let serpFetchBingCopilot: jest.Mock;

  /** idempotency lookup (where.idempotencyKey) vs by-id lookup (where.id) share prisma.aiSearchRun.findUnique. */
  let idempotencyRow: unknown; // createRun's findUnique({where:{idempotencyKey}})
  let byIdRow: unknown; // findById's findUnique({where:{id}})

  beforeAll(async () => {
    queueAdd = jest.fn().mockResolvedValue({ id: 'run-1' });
    runCreate = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'run-1', ...args.data }),
    );
    runFindUnique = jest.fn((args: { where: Record<string, unknown> }) =>
      Promise.resolve('idempotencyKey' in args.where ? idempotencyRow : byIdRow),
    );
    serpFetchAiOverviews = jest.fn().mockResolvedValue([]);
    serpFetchAiModes = jest.fn().mockResolvedValue([]);
    serpFetchBingCopilot = jest.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getQueueToken(AI_SEARCH_QUEUE))
      .useValue({ add: queueAdd, getJob: jest.fn().mockResolvedValue(null) })
      .overrideProvider(SERP_AI_PROVIDER)
      .useValue({
        fetchAiOverviews: serpFetchAiOverviews,
        fetchAiModes: serpFetchAiModes,
        fetchBingCopilot: serpFetchBingCopilot,
      })
      .overrideProvider(BULL_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(TOPIC_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(TOPIC_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(JOURNEY_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOURNEY_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(CUSTOM_CLASSIFY_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(AI_SEARCH_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(AI_SEARCH_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(PrismaService)
      .useValue({
        aiSearchRun: { findUnique: runFindUnique, create: runCreate, update: jest.fn() },
      })
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
      .overrideProvider(AiSearchProcessor)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
    idempotencyRow = null;
    byIdRow = null;
  });

  const post = (body: object) =>
    request(app.getHttpServer())
      .post('/api/v1/ai-search-analyses')
      .set('x-api-key', API_KEY)
      .send(body);

  const validBody = { keywords: ['asus zenbook'], channels: ['chatGpt', 'aiOverview'] };

  it('202 + {jobId} (enqueue-only, zero external calls)', async () => {
    idempotencyRow = null; // fresh → create + enqueue
    const res = await post(validBody).expect(202);
    expect(res.body).toEqual({ jobId: 'run-1' });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    // zero external calls on the POST path (SerpAPI provider never touched)
    expect(serpFetchAiOverviews).not.toHaveBeenCalled();
    expect(serpFetchAiModes).not.toHaveBeenCalled();
    expect(serpFetchBingCopilot).not.toHaveBeenCalled();
  });

  it('idempotency hit returns the same jobId without enqueuing again', async () => {
    idempotencyRow = { id: 'run-1', status: 'queued' }; // existing non-terminal run
    const res = await post(validBody).expect(202);
    expect(res.body).toEqual({ jobId: 'run-1' });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('400 for empty keywords', async () => {
    await post({ keywords: [], channels: ['chatGpt'] }).expect(400);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('400 for empty channels', async () => {
    await post({ keywords: ['a'], channels: [] }).expect(400);
  });

  it('400 for an unknown channel', async () => {
    await post({ keywords: ['a'], channels: ['notAChannel'] }).expect(400);
  });

  it('400 for a non-UUID brandProfileId', async () => {
    await post({ keywords: ['a'], channels: ['chatGpt'], brandProfileId: 'nope' }).expect(400);
  });

  it('401 without an API key (global guard)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/ai-search-analyses')
      .send(validBody)
      .expect(401);
  });

  it('GET returns the run status', async () => {
    byIdRow = {
      id: RID,
      ownerId: null,
      status: 'partial',
      progress: { phase: 'done', percent: 100 },
      captureCount: 2,
    };
    const res = await request(app.getHttpServer())
      .get(`/api/v1/ai-search-analyses/${RID}`)
      .set('x-api-key', API_KEY)
      .expect(200);
    expect(res.body).toMatchObject({ jobId: RID, status: 'partial', captureCount: 2 });
  });

  it('GET returns 404 for an unknown run', async () => {
    byIdRow = null;
    await request(app.getHttpServer())
      .get(`/api/v1/ai-search-analyses/${RID}`)
      .set('x-api-key', API_KEY)
      .expect(404);
  });

  it('GET 400 for a malformed (non-UUID) :id — pipe short-circuits before the service', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ai-search-analyses/not-a-uuid')
      .set('x-api-key', API_KEY)
      .expect(400);
    expect(runFindUnique).not.toHaveBeenCalled();
  });

  it('SSE stream returns an empty (non-hanging) stream for an unknown run', async () => {
    byIdRow = null;
    await request(app.getHttpServer())
      .get(`/api/v1/ai-search-analyses/${RID}/stream`)
      .set('x-api-key', API_KEY)
      .expect(200);
  });

  it('SSE 400 for a malformed (non-UUID) :id — pipe rejects before the SSE handler', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ai-search-analyses/not-a-uuid/stream')
      .set('x-api-key', API_KEY)
      .expect(400);
  });
});
