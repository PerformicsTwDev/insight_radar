import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import { CustomClassifyAssignProcessor } from 'src/custom-classify/custom-classify-assign.processor';
import { JourneyProcessor } from 'src/journey/journey.processor';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { PrismaService } from 'src/prisma';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
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
import { BULL_CONNECTION, CUSTOM_CLASSIFY_QUEUE } from 'src/queue/queue.constants';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';

const API_KEY = 'test-api-key'; // matches .env.test
const AN = '11111111-1111-1111-1111-111111111111';
const CID = '22222222-2222-2222-2222-222222222222';
const LABELS = [{ label: 'transactional', description: 'buy' }];

/**
 * TC-70（T12.8 · FR-34/AC-34.2/34.3）：`POST /keyword-analyses/:id/custom-classifications/:cid/assignments` 為
 * **enqueue-only、零外部呼叫**。以替身隔離：假 custom-classify queue（getQueueToken）、ioredis-mock、假 prisma →
 * 驗 202 只入列、404（未知/cid 不屬 :id）、400（非 UUID / 空標籤 / whitelist）、413（超量）、401、GET 404/200、
 * SSE 未知回空串流（不 hang）。
 */
describe('POST/GET/SSE /keyword-analyses/:id/custom-classifications/:cid/assignments (e2e, TC-70)', () => {
  let app: INestApplication<App>;
  let queueAdd: jest.Mock;
  let ccFindUnique: jest.Mock;
  let kaFindUnique: jest.Mock;
  let snapshotCount: jest.Mock;
  let ccrFindFirst: jest.Mock;

  beforeAll(async () => {
    queueAdd = jest.fn().mockResolvedValue({ id: 'run-1' });
    ccFindUnique = jest.fn().mockResolvedValue({ analysisId: AN, snapshotId: 'snap-1' });
    kaFindUnique = jest.fn().mockResolvedValue({ ownerId: null });
    snapshotCount = jest.fn().mockResolvedValue(3);
    ccrFindFirst = jest.fn().mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getQueueToken(CUSTOM_CLASSIFY_QUEUE))
      .useValue({ add: queueAdd, remove: jest.fn().mockResolvedValue(0) })
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
      .overrideProvider(PrismaService)
      .useValue({
        customClassification: { findUnique: ccFindUnique, update: jest.fn().mockResolvedValue({}) },
        keywordAnalysis: { findUnique: kaFindUnique },
        snapshotRow: { count: snapshotCount },
        resultSnapshot: { findUniqueOrThrow: jest.fn().mockResolvedValue({ checksum: 'chk' }) },
        customClassifyRun: {
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: ccrFindFirst,
          create: jest.fn((args: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'run-1', ...args.data }),
          ),
          delete: jest.fn(),
        },
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
    ccFindUnique.mockResolvedValue({ analysisId: AN, snapshotId: 'snap-1' });
    kaFindUnique.mockResolvedValue({ ownerId: null });
    snapshotCount.mockResolvedValue(3);
    ccrFindFirst.mockResolvedValue(null);
  });

  const url = (id: string, cid: string) =>
    `/api/v1/keyword-analyses/${id}/custom-classifications/${cid}/assignments`;
  const post = (id: string, cid: string, body: object) =>
    request(app.getHttpServer()).post(url(id, cid)).set('x-api-key', API_KEY).send(body);

  it('202 + {jobId} (enqueue-only) for a valid confirmed-label set', async () => {
    const res = await post(AN, CID, { labels: LABELS }).expect(202);
    expect(res.body).toEqual({ jobId: 'run-1' });
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it('401 without an API key (global guard)', async () => {
    await request(app.getHttpServer()).post(url(AN, CID)).send({ labels: LABELS }).expect(401);
  });

  it('404 when the classification id is unknown', async () => {
    ccFindUnique.mockResolvedValue(null);
    await post(AN, CID, { labels: LABELS }).expect(404);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('404 when the classification belongs to a different analysis (IDOR: :cid not under :id)', async () => {
    ccFindUnique.mockResolvedValue({
      analysisId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      snapshotId: 'snap-1',
    });
    await post(AN, CID, { labels: LABELS }).expect(404);
  });

  it('400 for a non-UUID id or cid (ParseUUIDPipe, not Prisma P2023 → 500)', async () => {
    await post('not-a-uuid', CID, { labels: LABELS }).expect(400);
    await post(AN, 'not-a-uuid', { labels: LABELS }).expect(400);
  });

  it('400 for an empty confirmed-label set (DTO ArrayMinSize)', async () => {
    await post(AN, CID, { labels: [] }).expect(400);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('400 for an unknown field (global whitelist forbidNonWhitelisted)', async () => {
    await post(AN, CID, { labels: LABELS, extra: 'x' }).expect(400);
  });

  it('413 when the snapshot keyword count exceeds the custom-classify max (cost guard)', async () => {
    snapshotCount.mockResolvedValue(5001); // > default CUSTOM_CLASSIFY_MAX_KEYWORDS (5000)
    await post(AN, CID, { labels: LABELS }).expect(413);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('413 when the confirmed-label count exceeds the custom-classify max labels (cost guard)', async () => {
    const tooMany = Array.from({ length: 13 }, (_, i) => ({ label: `l${i}`, description: 'd' }));
    await post(AN, CID, { labels: tooMany }).expect(413); // > default CUSTOM_CLASSIFY_MAX_LABELS (12)
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('GET returns 404 when there is no run', async () => {
    ccrFindFirst.mockResolvedValue(null);
    await request(app.getHttpServer()).get(url(AN, CID)).set('x-api-key', API_KEY).expect(404);
  });

  it('GET returns the latest run status', async () => {
    ccrFindFirst.mockResolvedValue({
      id: 'run-1',
      classificationId: CID,
      snapshotId: 'snap-1',
      status: 'completed',
      progress: { phase: 'done', percent: 100 },
      keywordCount: 3,
    });
    const res = await request(app.getHttpServer())
      .get(url(AN, CID))
      .set('x-api-key', API_KEY)
      .expect(200);
    expect(res.body).toMatchObject({ jobId: 'run-1', status: 'completed', keywordCount: 3 });
  });

  it('SSE stream returns an empty (non-hanging) stream for an unknown classification', async () => {
    ccFindUnique.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(`${url(AN, CID)}/stream`)
      .set('x-api-key', API_KEY)
      .expect(200);
  });
});
