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
import { JourneyProcessor } from 'src/journey/journey.processor';
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';
import type { SnapshotRowData } from 'src/keyword-analysis/result-snapshot.checksum';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import {
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from 'src/queue/topic-job-events.constants';
import {
  JOURNEY_JOB_EVENTS_CONNECTION,
  JOURNEY_QUEUE_EVENTS,
} from 'src/queue/journey-job-events.constants';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';
import { PrismaService } from 'src/prisma';

const API_KEY = 'test-api-key';
const ID = '66666666-6666-6666-6666-666666666666';

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

const ROWS: SnapshotRowData[] = [
  srow({ normalizedText: 'a', monthlyVolumes: [{ year: 2026, month: 1, searches: 100 }] }),
  srow({
    normalizedText: 'b',
    monthlyVolumes: [
      { year: 2026, month: 1, searches: 50 },
      { year: 2026, month: 2, searches: 30 },
    ],
  }),
];

interface TrendBody {
  axis?: string[];
  total?: number[];
}

/**
 * TC-38（NFR-10 · FR-14）：版本前綴 + 讀取層形狀。`/api/v1` 前綴生效（業務路由僅在前綴下）、`GET /health`
 * 不掛前綴仍可達；讀取層僅 `GET /keywords` + `POST /query` 兩 primitive，**無** `/aggregate`、`/trend` 端點；
 * `view:'trend'` ≡ month 分組 sum(monthlySearches)。
 */
describe('api version prefix + read-layer shape (e2e, TC-38)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const prisma = {
      keywordAnalysis: {
        findUnique: jest.fn(() =>
          Promise.resolve({ status: 'completed', resultSnapshotId: 'snap-1' }),
        ),
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
      .overrideProvider(JOURNEY_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOURNEY_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(JourneyProcessor)
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

  const key = (r: request.Test) => r.set('x-api-key', API_KEY);
  const server = () => app.getHttpServer();

  it('serves business routes ONLY under /api/v1 (bare path → 404)', async () => {
    expect(
      (await key(request(server()).get(`/api/v1/keyword-analyses/${ID}/keywords`))).status,
    ).toBe(200);
    // 同路由去掉 /api/v1 前綴 → 無對應路由 → 404（前綴確實生效，非湊巧）。
    expect((await key(request(server()).get(`/keyword-analyses/${ID}/keywords`))).status).toBe(404);
  });

  it('excludes GET /health from the prefix (/health reachable, /api/v1/health → 404)', async () => {
    expect([200, 503]).toContain((await request(server()).get('/health')).status); // 免前綴、免認證可達
    expect((await request(server()).get('/api/v1/health')).status).toBe(404); // health 不在前綴下
  });

  it('exposes only two read primitives — no /aggregate or /trend endpoints', async () => {
    expect(
      (await key(request(server()).post(`/api/v1/keyword-analyses/${ID}/aggregate`))).status,
    ).toBe(404);
    expect((await key(request(server()).post(`/api/v1/keyword-analyses/${ID}/trend`))).status).toBe(
      404,
    );
    // 兩 primitive 確實存在（非全 404 的偽綠）。
    expect(
      (await key(request(server()).get(`/api/v1/keyword-analyses/${ID}/keywords`))).status,
    ).toBe(200);
    expect(
      (
        await key(request(server()).post(`/api/v1/keyword-analyses/${ID}/query`)).send({
          view: 'keywords',
        })
      ).status,
    ).toBe(200);
  });

  it("view:'trend' equals month-grouped sum(monthlySearches)", async () => {
    const res = await key(
      request(server()).post(`/api/v1/keyword-analyses/${ID}/query`).send({ view: 'trend' }),
    );
    expect(res.status).toBe(200);
    const body = res.body as TrendBody;
    expect(body.axis).toEqual(['2026-01', '2026-02']);
    expect(body.total).toEqual([150, 30]); // 2026-01: 100+50, 2026-02: 30
  });
});
