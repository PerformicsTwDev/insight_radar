import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import { JourneyProcessor } from 'src/journey/journey.processor';
import {
  CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION,
  CUSTOM_CLASSIFY_QUEUE_EVENTS,
} from 'src/queue/custom-classify-job-events.constants';
import { CustomClassifyAssignProcessor } from 'src/custom-classify/custom-classify-assign.processor';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { PrismaService } from 'src/prisma';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import {
  JOURNEY_JOB_EVENTS_CONNECTION,
  JOURNEY_QUEUE_EVENTS,
} from 'src/queue/journey-job-events.constants';
import {
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from 'src/queue/topic-job-events.constants';
import { BULL_CONNECTION, JOURNEY_QUEUE } from 'src/queue/queue.constants';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';

const API_KEY = 'test-api-key'; // matches .env.test
const AID = '11111111-1111-1111-1111-111111111111'; // valid UUID (:id 經 ParseUUIDPipe，M12-R6)

/**
 * TC-69（T12.6 · FR-33/AC-33.6）：`POST /keyword-analyses/:id/journey` 為 **enqueue-only、零外部呼叫**。
 * 以替身隔離：假 journey queue（getQueueToken）、ioredis-mock、假 prisma → 驗 202 只入列、狀態碼
 * 202/425/409/404/413、401 無 key、SSE 未知 analysis 回空串流（不 hang）。
 */
describe('POST/GET/SSE /keyword-analyses/:id/journey (e2e, TC-69)', () => {
  let app: INestApplication<App>;
  let queueAdd: jest.Mock;
  let findAnalysis: jest.Mock;
  let snapshotCount: jest.Mock;
  let journeyFindFirst: jest.Mock;
  let snapshotFindMany: jest.Mock;
  let assignmentFindMany: jest.Mock;

  const analysisRow = (status: string) => ({
    id: 'a-1',
    ownerId: null,
    status,
    params: { geo: 'US', language: 'en' },
    resultSnapshot:
      status === 'completed' || status === 'partial'
        ? { id: 'snap-1', checksum: 'chk', keywordCount: 3 }
        : null,
  });

  beforeAll(async () => {
    queueAdd = jest.fn().mockResolvedValue({ id: 'run-1' });
    findAnalysis = jest.fn();
    snapshotCount = jest.fn().mockResolvedValue(3);
    journeyFindFirst = jest.fn().mockResolvedValue(null);
    snapshotFindMany = jest.fn().mockResolvedValue([]);
    assignmentFindMany = jest.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getQueueToken(JOURNEY_QUEUE))
      .useValue({ add: queueAdd, getJob: jest.fn().mockResolvedValue(null) })
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
      .overrideProvider(PrismaService)
      .useValue({
        keywordAnalysis: { findUnique: findAnalysis },
        snapshotRow: { count: snapshotCount, findMany: snapshotFindMany },
        keywordJourneyAssignment: { findMany: assignmentFindMany },
        journeyRun: {
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: journeyFindFirst,
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
      .overrideProvider(CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(CUSTOM_CLASSIFY_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
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
    snapshotCount.mockResolvedValue(3);
    journeyFindFirst.mockResolvedValue(null);
    snapshotFindMany.mockResolvedValue([]);
    assignmentFindMany.mockResolvedValue([]);
  });

  const query = (id: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/keyword-analyses/${id}/query`)
      .set('x-api-key', API_KEY)
      .send(body);

  const post = (id: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/keyword-analyses/${id}/journey`)
      .set('x-api-key', API_KEY);

  it('202 + journeyJobId (enqueue-only) for a completed analysis', async () => {
    findAnalysis.mockResolvedValue(analysisRow('completed'));
    const res = await post(AID).expect(202);
    expect(res.body).toEqual({ journeyJobId: 'run-1' });
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it('425 when the analysis is still running (snapshot not ready)', async () => {
    findAnalysis.mockResolvedValue(analysisRow('running'));
    await post(AID).expect(425);
  });

  it('409 when the analysis failed (no usable snapshot)', async () => {
    findAnalysis.mockResolvedValue(analysisRow('failed'));
    await post(AID).expect(409);
  });

  it('404 when the analysis does not exist', async () => {
    findAnalysis.mockResolvedValue(null);
    await post(AID).expect(404);
  });

  it('POST 400 for a malformed (non-UUID) :id — ParseUUIDPipe short-circuits before the service (M12-R6)', async () => {
    // Real Prisma would raise P2023 → 500 on a non-UUID @db.Uuid lookup; the pipe rejects first with 400.
    // Assert the service was never reached (findAnalysis is its first prisma call) so this doesn't rely on
    // whatever a prior test left in the fake prisma — the 400 comes purely from the pipe.
    await post('not-a-uuid').expect(400);
    expect(findAnalysis).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('413 when the snapshot keyword count exceeds the journey max (#484 cost guard)', async () => {
    findAnalysis.mockResolvedValue(analysisRow('completed'));
    snapshotCount.mockResolvedValue(5001); // > default JOURNEY_MAX_KEYWORDS (5000)
    await post(AID).expect(413);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('401 without an API key (global guard)', async () => {
    await request(app.getHttpServer()).post(`/api/v1/keyword-analyses/${AID}/journey`).expect(401);
  });

  it('401 (not 400) for a malformed :id with no API key — guard runs before the pipe (M12-R6)', async () => {
    // Nest ordering: Guards → Pipes. A missing key must 401 before ParseUUIDPipe can 400 on the bad uuid.
    await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses/not-a-uuid/journey')
      .expect(401);
  });

  it('GET returns 404 when there is no journey run', async () => {
    findAnalysis.mockResolvedValue(analysisRow('completed'));
    journeyFindFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(`/api/v1/keyword-analyses/${AID}/journey`)
      .set('x-api-key', API_KEY)
      .expect(404);
  });

  it('GET 400 for a malformed (non-UUID) :id — pipe short-circuits before the service (M12-R6)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/keyword-analyses/not-a-uuid/journey')
      .set('x-api-key', API_KEY)
      .expect(400);
    expect(findAnalysis).not.toHaveBeenCalled(); // self-contained: proves the pipe rejected, not the fake prisma
  });

  it('GET returns the latest run status', async () => {
    findAnalysis.mockResolvedValue(analysisRow('completed'));
    journeyFindFirst.mockResolvedValue({
      id: 'run-1',
      snapshotId: 'snap-1',
      status: 'completed',
      progress: { phase: 'done', percent: 100 },
      keywordCount: 3,
    });
    const res = await request(app.getHttpServer())
      .get(`/api/v1/keyword-analyses/${AID}/journey`)
      .set('x-api-key', API_KEY)
      .expect(200);
    expect(res.body).toMatchObject({ journeyJobId: 'run-1', status: 'completed', keywordCount: 3 });
  });

  it('SSE stream returns an empty (non-hanging) stream for an unknown analysis', async () => {
    findAnalysis.mockResolvedValue(null);
    journeyFindFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(`/api/v1/keyword-analyses/${AID}/journey/stream`)
      .set('x-api-key', API_KEY)
      .expect(200);
  });

  it('SSE stream 400 for a malformed (non-UUID) :id — pipe rejects before the SSE handler (M12-R6)', async () => {
    // Pipe runs during param binding, before stream()'s "never reject" body → normal 400, not a hung stream.
    await request(app.getHttpServer())
      .get('/api/v1/keyword-analyses/not-a-uuid/journey/stream')
      .set('x-api-key', API_KEY)
      .expect(400);
    expect(findAnalysis).not.toHaveBeenCalled(); // getRunRef (→ findAnalysis) never reached
  });

  it('POST /query {view:journey} → 409 FEATURE_NOT_READY with no completed journey run (AC-33.4)', async () => {
    findAnalysis.mockResolvedValue({
      status: 'completed',
      resultSnapshotId: 'snap-1',
      ownerId: null,
    });
    journeyFindFirst.mockResolvedValue(null); // no run → journey feature not_generated → gated
    // /query :id 走 ParseUUIDPipe（與 journey/topics 端點不同）→ 用合法 UUID。
    const res = await query('11111111-1111-1111-1111-111111111111', { view: 'journey' }).expect(
      409,
    );
    expect((res.body as { code: string }).code).toBe('FEATURE_NOT_READY');
  });

  it('POST /query {view:journey} → 200 with stage left-joined once the run is completed (AC-33.4)', async () => {
    findAnalysis.mockResolvedValue({
      status: 'completed',
      resultSnapshotId: 'snap-1',
      ownerId: null,
    });
    journeyFindFirst.mockResolvedValue({ status: 'completed' }); // journey feature ready
    snapshotFindMany.mockResolvedValue([
      {
        data: {
          text: 'coffee',
          normalizedText: 'coffee',
          avgMonthlySearches: 100,
          competition: 'LOW',
          competitionIndex: 1,
          cpcLow: 1,
          cpcHigh: 2,
          intent: ['informational'],
          monthlyVolumes: [],
        },
      },
    ]);
    assignmentFindMany.mockResolvedValue([{ normalizedText: 'coffee', stage: 'final_decision' }]);

    const res = await query('11111111-1111-1111-1111-111111111111', {
      view: 'journey',
      select: ['text', 'stage'],
    }).expect(200);
    const body = res.body as { view: string; rows: unknown[] };
    expect(body.view).toBe('journey');
    expect(body.rows).toEqual([{ text: 'coffee', stage: 'final_decision' }]);
  });
});
