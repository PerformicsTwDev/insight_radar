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

/**
 * TC-70（T12.9 · FR-34/AC-34.3·34.5）：自訂分類動態 view `POST /query {view:'custom:{cid}'}` + `DELETE
 * /keyword-analyses/:id/custom-classifications/:cid`。以替身隔離（假 prisma / ioredis-mock）→ 驗 view 200
 * （label left-join）/ 404（未知 cid）/ 409（無 completed run）；DELETE 200（級聯）/ 404（未知）/ 400（非 UUID）/ 401。
 */
describe('custom:{cid} view + DELETE (e2e, TC-70)', () => {
  let app: INestApplication<App>;
  let ccFindUnique: jest.Mock;
  let ccrFindFirst: jest.Mock;
  let kcaFindMany: jest.Mock;
  let txn: jest.Mock;

  beforeAll(async () => {
    ccFindUnique = jest.fn().mockResolvedValue({ analysisId: AN });
    ccrFindFirst = jest.fn().mockResolvedValue({ status: 'completed' });
    kcaFindMany = jest
      .fn()
      .mockResolvedValue([{ normalizedText: 'coffee', label: 'transactional' }]);
    txn = jest.fn().mockResolvedValue([]);

    const kaFindUnique = jest.fn().mockResolvedValue({
      status: 'completed',
      resultSnapshotId: 'snap-1',
      ownerId: null,
    });
    const srFindMany = jest.fn().mockResolvedValue([
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
    const prisma = {
      keywordAnalysis: { findUnique: kaFindUnique },
      customClassification: {
        findUnique: ccFindUnique,
        delete: jest.fn().mockReturnValue('op-cc'),
      },
      customClassifyRun: {
        findFirst: ccrFindFirst,
        deleteMany: jest.fn().mockReturnValue('op-ccr'),
      },
      keywordCustomAssignment: {
        findMany: kcaFindMany,
        deleteMany: jest.fn().mockReturnValue('op-kca'),
      },
      snapshotRow: { findMany: srFindMany },
      $transaction: txn,
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getQueueToken(CUSTOM_CLASSIFY_QUEUE))
      .useValue({ add: jest.fn(), getJob: jest.fn().mockResolvedValue(null) })
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
      .useValue(prisma)
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
    ccFindUnique.mockResolvedValue({ analysisId: AN });
    ccrFindFirst.mockResolvedValue({ status: 'completed' });
    kcaFindMany.mockResolvedValue([{ normalizedText: 'coffee', label: 'transactional' }]);
    txn.mockResolvedValue([]);
  });

  const query = (id: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/keyword-analyses/${id}/query`)
      .set('x-api-key', API_KEY)
      .send(body);
  const del = (id: string, cid: string) =>
    request(app.getHttpServer())
      .delete(`/api/v1/keyword-analyses/${id}/custom-classifications/${cid}`)
      .set('x-api-key', API_KEY);

  describe('POST /query {view:custom:{cid}}', () => {
    it('200 with label left-joined for a completed classification', async () => {
      const res = await query(AN, { view: `custom:${CID}`, select: ['text', 'label'] }).expect(200);
      const body = res.body as { view: string; rows: unknown[] };
      expect(body.view).toBe(`custom:${CID}`);
      expect(body.rows).toEqual([{ text: 'coffee', label: 'transactional' }]);
    });

    it('404 for an unknown classification id', async () => {
      ccFindUnique.mockResolvedValue(null);
      await query(AN, { view: `custom:${CID}` }).expect(404);
    });

    it('409 FEATURE_NOT_READY when there is no completed classify run', async () => {
      ccrFindFirst.mockResolvedValue(null);
      const res = await query(AN, { view: `custom:${CID}` }).expect(409);
      expect((res.body as { code?: string }).code).toBe('FEATURE_NOT_READY');
    });

    it('401 without an API key', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/keyword-analyses/${AN}/query`)
        .send({ view: `custom:${CID}` })
        .expect(401);
    });
  });

  describe('DELETE /keyword-analyses/:id/custom-classifications/:cid', () => {
    it('200 + {classificationId} and cascades in one transaction', async () => {
      const res = await del(AN, CID).expect(200);
      expect(res.body).toEqual({ classificationId: CID });
      expect(txn).toHaveBeenCalledWith(['op-kca', 'op-ccr', 'op-cc']);
    });

    it('404 for an unknown classification id', async () => {
      ccFindUnique.mockResolvedValue(null);
      await del(AN, CID).expect(404);
      expect(txn).not.toHaveBeenCalled();
    });

    it('400 for a non-UUID cid (ParseUUIDPipe)', async () => {
      await del(AN, 'not-a-uuid').expect(400);
    });

    it('401 without an API key', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/keyword-analyses/${AN}/custom-classifications/${CID}`)
        .expect(401);
    });
  });
});
