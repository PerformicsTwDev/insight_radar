import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';
import { PrismaService } from 'src/prisma';

const API_KEY = 'test-api-key';
const ID = '55555555-5555-5555-5555-555555555555';

type Method = 'get' | 'post' | 'delete';

/** 每個受保護端點（method + path）——全域 `ApiKeyGuard` 應在無 `x-api-key` 時一律 401（TC-25）。 */
const PROTECTED: { method: Method; path: string; label: string }[] = [
  { method: 'post', path: '/api/v1/keyword-analyses', label: 'POST /keyword-analyses (create)' },
  { method: 'get', path: `/api/v1/keyword-analyses/${ID}`, label: 'GET /:id (status)' },
  { method: 'delete', path: `/api/v1/keyword-analyses/${ID}`, label: 'DELETE /:id (cancel)' },
  { method: 'get', path: `/api/v1/keyword-analyses/${ID}/stream`, label: 'GET /:id/stream (SSE)' },
  { method: 'get', path: `/api/v1/keyword-analyses/${ID}/keywords`, label: 'GET /:id/keywords' },
  { method: 'post', path: `/api/v1/keyword-analyses/${ID}/query`, label: 'POST /:id/query' },
];

/**
 * TC-25（FR-11 · NFR-5）：認證邊界。所有受保護端點無 `x-api-key` → **401**（守衛先於 pipe/handler，不洩漏
 * 存在性/驗證細節）；`GET /health` 為 `@Public`，免認證可存取。含正向對照：帶正確 key 時不再是 401。
 */
describe('auth boundary (e2e, TC-25)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const prisma = {
      keywordAnalysis: { findUnique: jest.fn(() => Promise.resolve(null)) },
      snapshotRow: { findMany: jest.fn(() => Promise.resolve([])) },
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
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (method: Method, path: string) => request(app.getHttpServer())[method](path);

  it.each(PROTECTED)(
    'rejects $label with 401 when x-api-key is missing',
    async ({ method, path }) => {
      const res = await call(method, path);
      expect(res.status).toBe(401);
    },
  );

  it.each(PROTECTED)(
    'rejects $label with 401 when x-api-key is wrong',
    async ({ method, path }) => {
      const res = await call(method, path).set('x-api-key', 'not-the-key');
      expect(res.status).toBe(401);
    },
  );

  it('allows GET /health without an api key (public — not auth-gated)', async () => {
    // 認證邊界的重點：守衛放行 `/health`（非 401/403），請求抵達 terminus handler。
    // 依賴健康（db/cache up → 200）由 health.int-spec 以真實依賴覆蓋；此處 in-process mock 的 DB
    // ping 會使 terminus 回 503，但 503≠被認證擋下——仍證明端點公開可達。
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect([200, 503]).toContain(res.status); // 抵達 terminus handler（up→200 / down→503），未被守衛攔
  });

  it('does not reach the guard-401 path when a valid api key is supplied (positive control)', async () => {
    // 帶正確 key → 守衛放行；即便後續 404/其他碼，也證明 401 來自缺 key 而非端點恆拒。
    const res = await request(app.getHttpServer())
      .get(`/api/v1/keyword-analyses/${ID}/keywords`)
      .set('x-api-key', API_KEY);
    expect(res.status).not.toBe(401);
  });
});
