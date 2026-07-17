import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import { CLUSTERING_PROVIDER } from 'src/clustering/clustering-provider.port';
import { EMBEDDING_PROVIDER } from 'src/embeddings/embedding-provider.port';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { PrismaService } from 'src/prisma';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION, TOPICS_QUEUE } from 'src/queue/queue.constants';
import {
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from 'src/queue/topic-job-events.constants';
import {
  JOURNEY_JOB_EVENTS_CONNECTION,
  JOURNEY_QUEUE_EVENTS,
} from 'src/queue/journey-job-events.constants';
import { SERP_PROVIDER } from 'src/serp/serp-provider.port';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import { JourneyProcessor } from 'src/journey/journey.processor';
import {
  CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION,
  CUSTOM_CLASSIFY_QUEUE_EVENTS,
} from 'src/queue/custom-classify-job-events.constants';
import { CustomClassifyAssignProcessor } from 'src/custom-classify/custom-classify-assign.processor';
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';

const API_KEY = 'test-api-key'; // matches .env.test

/**
 * TC-48（T8.10b · FR-15）：`POST /keyword-analyses/:id/topics` 為 **enqueue-only、零外部呼叫**。以替身隔離：
 * 假 topics queue（getQueueToken）、ioredis-mock、假 prisma、外部 provider（embed/cluster/serp）spy →
 * 驗 POST 只入列、外部 0 次；狀態碼 202/425/409/404；SSE 未知 analysis 回空串流（不 hang）。
 */
describe('POST/GET /keyword-analyses/:id/topics (e2e, TC-48)', () => {
  let app: INestApplication<App>;
  let queueAdd: jest.Mock;
  let findAnalysis: jest.Mock;
  const embed = jest.fn();
  const cluster = jest.fn();
  const serpFetch = jest.fn();

  const analysisRow = (status: string) => ({
    id: 'a-1',
    status,
    params: { geo: 'US', language: 'en' },
    resultSnapshot:
      status === 'completed' ? { id: 'snap-1', checksum: 'chk', keywordCount: 3 } : null,
  });

  beforeAll(async () => {
    queueAdd = jest.fn().mockResolvedValue({ id: 'run-1' });
    findAnalysis = jest.fn();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getQueueToken(TOPICS_QUEUE))
      .useValue({ add: queueAdd })
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
      .overrideProvider(PrismaService)
      .useValue({
        keywordAnalysis: { findUnique: findAnalysis },
        topicRun: {
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn((args: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'run-1', ...args.data }),
          ),
          delete: jest.fn(),
        },
      })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed })
      .overrideProvider(CLUSTERING_PROVIDER)
      .useValue({ cluster })
      .overrideProvider(SERP_PROVIDER)
      .useValue({ fetch: serpFetch })
      .overrideProvider(KeywordAnalysisProcessor)
      .useValue({})
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

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => jest.clearAllMocks());

  const post = (id: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/keyword-analyses/${id}/topics`)
      .set('x-api-key', API_KEY);

  it('202 + topicJobId and NO external calls for a completed analysis', async () => {
    findAnalysis.mockResolvedValue(analysisRow('completed'));

    const res = await post('a-1').send({ serpEnabled: false }).expect(202);

    expect(res.body).toEqual({ topicJobId: 'run-1' });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    // 零外部呼叫（NFR-1）：embed/cluster/serp 皆在 worker，POST 路徑不碰。
    expect(embed).not.toHaveBeenCalled();
    expect(cluster).not.toHaveBeenCalled();
    expect(serpFetch).not.toHaveBeenCalled();
  });

  it('425 when the analysis is still running (snapshot not ready)', async () => {
    findAnalysis.mockResolvedValue(analysisRow('running'));
    await post('a-1').send({}).expect(425);
  });

  it('409 when the analysis failed (no usable snapshot)', async () => {
    findAnalysis.mockResolvedValue(analysisRow('failed'));
    await post('a-1').send({}).expect(409);
  });

  it('404 when the analysis does not exist', async () => {
    findAnalysis.mockResolvedValue(null);
    await post('missing').send({}).expect(404);
  });

  it('401 without an API key (global guard)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses/a-1/topics')
      .send({})
      .expect(401);
  });

  it('SSE stream returns an empty (non-hanging) stream for an unknown analysis', async () => {
    // findFirst → null（無 run）→ handler 回 EMPTY → 連線立即完成、不 hang。
    await request(app.getHttpServer())
      .get('/api/v1/keyword-analyses/unknown/topics/stream')
      .set('x-api-key', API_KEY)
      .expect(200);
  });
});
