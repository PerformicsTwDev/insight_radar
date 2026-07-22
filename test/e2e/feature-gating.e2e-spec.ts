import { getQueueToken } from '@nestjs/bullmq';
import { overrideBackgroundWorkers } from './helpers/background-workers';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import type { SnapshotRowData } from 'src/keyword-analysis/result-snapshot.checksum';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';
import { PrismaService } from 'src/prisma';

const API_KEY = 'test-api-key';
const ID = '77777777-7777-7777-7777-777777777777';

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

interface StatusBody {
  status?: string;
  features?: Record<string, { status: string }>;
}
interface ErrBody {
  code?: string;
  rows?: unknown[];
}

/**
 * TC-53（FR-14 · AC-14.7）：view feature-gating。`GET /:id` 回 `features.<feature>.status`；依賴未產生 compute
 * 的 view（`serp_questions` 需 SERP、`intent_topics` 需分群）→ 回 **409 FEATURE_NOT_READY**（非誤導空表）；
 * 基底 `keyword_metrics` view（snapshot 就緒）不 gate。
 */
describe('view feature-gating (e2e, TC-53)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const prisma = {
      keywordAnalysis: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            status: 'completed',
            resultSnapshotId: 'snap-1',
            progress: { phase: 'done', percent: 100 },
            resultSnapshot: { id: 'snap-1', keywordCount: 1 },
          }),
        ),
      },
      snapshotRow: {
        findMany: jest.fn(() => Promise.resolve([{ data: srow({ normalizedText: 'a' }) }])),
      },
      // getStatus 讀最新 JourneyRun / linked AiSearchRun 以推導 journey / ai_search feature；無 run → not_generated。
      journeyRun: { findFirst: jest.fn(() => Promise.resolve(null)) },
      aiSearchRun: { findFirst: jest.fn(() => Promise.resolve(null)) },
    };

    const moduleRef = await overrideBackgroundWorkers(
      Test.createTestingModule({ imports: [AppModule] }),
    )
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

  const base = `/api/v1/keyword-analyses/${ID}`;
  const post = (body: object) =>
    request(app.getHttpServer()).post(`${base}/query`).set('x-api-key', API_KEY).send(body);

  it('GET /:id reports features.<feature>.status', async () => {
    const res = await request(app.getHttpServer()).get(base).set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    const body = res.body as StatusBody;
    expect(body.features?.keyword_metrics.status).toBe('ready'); // snapshot 就緒
    expect(body.features?.serp.status).toBe('not_generated'); // SERP compute 未實作
    expect(body.features?.topics.status).toBe('not_generated'); // 分群 compute 未實作
  });

  it('POST /query serp_questions → 409 FEATURE_NOT_READY (not a misleading empty table)', async () => {
    const res = await post({ view: 'serp_questions' });
    expect(res.status).toBe(409);
    const body = res.body as ErrBody;
    expect(body.code).toBe('FEATURE_NOT_READY');
    expect(body.rows).toBeUndefined(); // 不回空表
  });

  it('POST /query intent_topics → 409 FEATURE_NOT_READY', async () => {
    const res = await post({ view: 'intent_topics' });
    expect(res.status).toBe(409);
    expect((res.body as ErrBody).code).toBe('FEATURE_NOT_READY');
  });

  it('POST /query keywords (base feature ready) → 200, not gated', async () => {
    const res = await post({ view: 'keywords' });
    expect(res.status).toBe(200);
    expect((res.body as ErrBody).rows).toHaveLength(1);
  });
});
