import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import type { SnapshotRowData } from 'src/keyword-analysis/result-snapshot.checksum';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';
import { PrismaService } from 'src/prisma';

const API_KEY = 'test-api-key';
const COMPLETED_ID = '11111111-1111-1111-1111-111111111111'; // 有不可變 snapshot → 可讀
const RUNNING_ID = '22222222-2222-2222-2222-222222222222'; // job 進行中、尚無 snapshot → not-ready
const UNKNOWN_ID = '33333333-3333-3333-3333-333333333333'; // 不存在 → 404

function srow(over: Partial<SnapshotRowData> = {}): SnapshotRowData {
  return {
    text: 'kw',
    normalizedText: 'kw',
    avgMonthlySearches: 100,
    competition: 'LOW',
    competitionIndex: 10,
    cpcLow: 1,
    cpcHigh: 2,
    intent: ['informational'],
    monthlyVolumes: [],
    ...over,
  };
}

const ROWS: SnapshotRowData[] = [srow()];

interface ErrBody {
  statusCode?: number;
  code?: string;
  data?: unknown[];
}
const asErr = (res: request.Response): ErrBody => res.body as ErrBody;

/**
 * TC-31（FR-6 · AC-6.4/6.5）：job 未完成回 not-ready（不給誤導資料）、未知 `analysisId` 回 404。
 * 讀取層只讀**不可變 snapshot**，故以 `resultSnapshotId` 是否存在為 readiness 判準：
 * 有 snapshot（completed / 已持久化 partial）→ 200；無 snapshot（queued/running）→ 409 NOT_READY；不存在 → 404。
 */
describe('read-layer readiness (e2e, TC-31)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const prisma = {
      keywordAnalysis: {
        findUnique: jest.fn((args: { where: { id: string } }) => {
          if (args.where.id === COMPLETED_ID) {
            return Promise.resolve({ status: 'completed', resultSnapshotId: 'snap-1' });
          }
          if (args.where.id === RUNNING_ID) {
            return Promise.resolve({ status: 'running', resultSnapshotId: null });
          }
          return Promise.resolve(null); // 不存在
        }),
      },
      snapshotRow: { findMany: jest.fn(() => Promise.resolve(ROWS.map((data) => ({ data })))) },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getQueueToken(KEYWORD_ANALYSIS_QUEUE))
      .useValue({ add: jest.fn(), getJob: jest.fn() })
      .overrideProvider(BULL_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(KeywordAnalysisProcessor)
      .useValue({})
      .overrideProvider(TopicClusterProcessor)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (id: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/keyword-analyses/${id}/keywords`)
      .set('x-api-key', API_KEY);
  const post = (id: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/keyword-analyses/${id}/query`)
      .set('x-api-key', API_KEY)
      .send({ view: 'keywords' });

  it('GET /keywords: completed analysis with a snapshot → 200 + data', async () => {
    const res = await get(COMPLETED_ID);
    expect(res.status).toBe(200);
    expect(asErr(res).data).toHaveLength(1);
  });

  it('GET /keywords: running job (no snapshot yet) → 409 NOT_READY, no misleading data', async () => {
    const res = await get(RUNNING_ID);
    expect(res.status).toBe(409);
    expect(asErr(res).code).toBe('NOT_READY');
    expect(asErr(res).data).toBeUndefined(); // 不回不完整誤導資料
  });

  it('GET /keywords: unknown analysisId → 404', async () => {
    const res = await get(UNKNOWN_ID);
    expect(res.status).toBe(404);
  });

  it('POST /query: running job → 409 NOT_READY (shares snapshot readiness)', async () => {
    const res = await post(RUNNING_ID);
    expect(res.status).toBe(409);
    expect(asErr(res).code).toBe('NOT_READY');
  });

  it('POST /query: unknown analysisId → 404', async () => {
    const res = await post(UNKNOWN_ID);
    expect(res.status).toBe(404);
  });
});
