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
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import {
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from 'src/queue/topic-job-events.constants';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';
import { PrismaService } from 'src/prisma';

const API_KEY = 'test-api-key';
const ID = '55555555-5555-5555-5555-555555555555';

type Method = 'get' | 'post' | 'delete';

/**
 * 每個受保護端點（method + path）——全域 `CompositeAuthGuard`（api-key 路徑，M10 起）應在無/錯 `x-api-key`
 * 且無 session 時一律 401（TC-25；機器 x-api-key 行為與 M9 前相容）。
 * `sse` 標記串流端點：正向對照（帶正確 key）會開啟長連線，故正向對照只跑非 SSE 端點以免 supertest 掛住。
 */
const PROTECTED: { method: Method; path: string; label: string; sse?: boolean }[] = [
  { method: 'post', path: '/api/v1/keyword-analyses', label: 'POST /keyword-analyses (create)' },
  { method: 'get', path: `/api/v1/keyword-analyses/${ID}`, label: 'GET /:id (status)' },
  { method: 'delete', path: `/api/v1/keyword-analyses/${ID}`, label: 'DELETE /:id (cancel)' },
  {
    method: 'get',
    path: `/api/v1/keyword-analyses/${ID}/stream`,
    label: 'GET /:id/stream (SSE)',
    sse: true,
  },
  { method: 'get', path: `/api/v1/keyword-analyses/${ID}/keywords`, label: 'GET /:id/keywords' },
  { method: 'post', path: `/api/v1/keyword-analyses/${ID}/query`, label: 'POST /:id/query' },
  { method: 'get', path: '/api/v1/keyword-analyses', label: 'GET /keyword-analyses (list)' },
  // M8 topics 三路由（#312：guard 已覆蓋但先前未在此邊界測試枚舉 → 補齊，防誤加 @Public 的無聲回歸）。
  { method: 'post', path: `/api/v1/keyword-analyses/${ID}/topics`, label: 'POST /:id/topics' },
  { method: 'get', path: `/api/v1/keyword-analyses/${ID}/topics`, label: 'GET /:id/topics' },
  {
    method: 'get',
    path: `/api/v1/keyword-analyses/${ID}/topics/stream`,
    label: 'GET /:id/topics/stream (SSE)',
    sse: true,
  },
];

/** 正向對照只跑非 SSE 端點（帶正確 key 的 SSE 會開串流、令 supertest 不 resolve）。 */
const NON_SSE = PROTECTED.filter((r) => !r.sse);

/**
 * TC-25（FR-11 · NFR-5）：認證邊界。所有受保護端點無 `x-api-key`（且無 session）→ **401**（守衛先於 pipe/handler，不洩漏
 * 存在性/驗證細節）；`GET /health` 為 `@Public`，免認證可存取。含正向對照：帶正確 key 時不再是 401。
 */
describe('auth boundary (e2e, TC-25)', () => {
  let app: INestApplication<App>;
  let prisma: {
    keywordAnalysis: { findUnique: jest.Mock };
    snapshotRow: { findMany: jest.Mock };
  };

  beforeAll(async () => {
    prisma = {
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
      .overrideProvider(TOPIC_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(TOPIC_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(KeywordAnalysisProcessor)
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

  it.each(NON_SSE)(
    'clears the guard (not 401) for $label when a valid api key is supplied (positive control)',
    async ({ method, path }) => {
      // 帶正確 key → 守衛放行；後續碼可為 400/404/其他，但**不得**是 401——證明 401 來自缺 key
      // 而非該端點恆拒（排除「blanket 401」偽綠）。逐端點跑，關掉 per-route 恆拒的偽綠窗。
      const res = await call(method, path).set('x-api-key', API_KEY);
      expect(res.status).not.toBe(401);
    },
  );

  it('returns the same generic 401 message for missing vs wrong key (no enumeration oracle)', async () => {
    // NFR-5：缺 key 與錯 key 的 401 訊息一致且通用——不洩漏「key 存在但錯」vs「未帶 key」的區別。
    const missing = (await call('get', `/api/v1/keyword-analyses/${ID}/keywords`)).body as {
      message?: string;
    };
    const wrong = (
      await call('get', `/api/v1/keyword-analyses/${ID}/keywords`).set('x-api-key', 'not-the-key')
    ).body as { message?: string };
    expect(missing.message).toBe('Authentication required');
    expect(wrong.message).toBe(missing.message);
  });

  it('short-circuits before any DB access on the 401 path (guard runs before handler)', async () => {
    prisma.keywordAnalysis.findUnique.mockClear();
    prisma.snapshotRow.findMany.mockClear();
    const res = await call('get', `/api/v1/keyword-analyses/${ID}/keywords`); // 無 key
    expect(res.status).toBe(401);
    expect(prisma.keywordAnalysis.findUnique).not.toHaveBeenCalled();
    expect(prisma.snapshotRow.findMany).not.toHaveBeenCalled();
  });
});
