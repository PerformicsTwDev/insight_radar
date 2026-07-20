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
const ANALYSIS_ID = '22222222-2222-2222-2222-222222222222';

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
  srow({
    normalizedText: 'a',
    cpcLow: 0.5,
    intent: ['commercial'],
    monthlyVolumes: [{ year: 2026, month: 1, searches: 100 }],
  }),
  srow({
    normalizedText: 'b',
    cpcLow: 1.5,
    intent: ['commercial', 'informational'],
    monthlyVolumes: [{ year: 2026, month: 2, searches: 50 }],
  }),
];

interface QueryBody {
  view: string;
  columns?: unknown[];
  rows?: unknown[];
  groups?: { key: Record<string, unknown>; measures: Record<string, number> }[];
  axis?: string[];
  total?: number[];
}
const asBody = (res: request.Response): QueryBody => res.body as QueryBody;

/**
 * TC-36：`POST /keyword-analyses/:id/query`（view-router）。各 view 回正確形狀；白名單/上限/`min>max` → 400。
 */
describe('POST /keyword-analyses/:id/query (e2e, TC-36)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const prisma = {
      keywordAnalysis: {
        findUnique: jest.fn(() => Promise.resolve({ resultSnapshotId: 'snap-1' })),
      },
      snapshotRow: { findMany: jest.fn(() => Promise.resolve(ROWS.map((data) => ({ data })))) },
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

  const url = `/api/v1/keyword-analyses/${ANALYSIS_ID}/query`;
  const post = (body: object) =>
    request(app.getHttpServer()).post(url).set('x-api-key', API_KEY).send(body);

  it('rejects without x-api-key (401)', async () => {
    const res = await request(app.getHttpServer()).post(url).send({ view: 'keywords' });
    expect(res.status).toBe(401);
  });

  it('routes view=keywords to a table envelope { view, columns, rows, pagination }', async () => {
    const res = await post({ view: 'keywords' });
    expect(res.status).toBe(200);
    expect(asBody(res).view).toBe('keywords');
    expect(Array.isArray(asBody(res).columns)).toBe(true);
    expect(asBody(res).rows).toHaveLength(2);
  });

  it('routes view=trend to { view, axis, total, series }', async () => {
    const res = await post({ view: 'trend' });
    expect(res.status).toBe(200);
    expect(asBody(res).axis).toEqual(['2026-01', '2026-02']);
    expect(asBody(res).total).toEqual([100, 50]);
  });

  it('routes view=intent_distribution to grouped { groups, meta } (explosion)', async () => {
    const res = await post({ view: 'intent_distribution' });
    expect(res.status).toBe(200);
    const commercial = asBody(res).groups?.find((g) => g.key.intentLabel === 'commercial');
    expect(commercial?.measures.count).toBe(2); // a + b both commercial
  });

  it('routes view=cpc_histogram to bucketed { groups, meta }', async () => {
    const res = await post({ view: 'cpc_histogram' });
    expect(res.status).toBe(200);
    expect(asBody(res).groups?.find((g) => g.key.bucket === 0)?.measures.count).toBe(1); // 0.5 → [0,1)
    expect(asBody(res).groups?.find((g) => g.key.bucket === 1)?.measures.count).toBe(1); // 1.5 → [1,2)
  });

  it('rejects an unknown view / non-whitelisted select / sort / min>max / pageSize>max with 400', async () => {
    expect((await post({ view: 'nope' })).status).toBe(400);
    expect((await post({ view: 'keywords', select: ['bogus'] })).status).toBe(400);
    expect(
      (await post({ view: 'keywords', sort: [{ field: 'bogus', direction: 'asc' }] })).status,
    ).toBe(400);
    expect(
      (await post({ view: 'keywords', filters: { volumeMin: 200, volumeMax: 100 } })).status,
    ).toBe(400);
    expect((await post({ view: 'keywords', pagination: { pageSize: 5000 } })).status).toBe(400);
  });

  it('rejects a malformed body (missing view / bad sort direction) with 400', async () => {
    expect((await post({})).status).toBe(400); // view required
    expect(
      (await post({ view: 'keywords', sort: [{ field: 'text', direction: 'sideways' }] })).status,
    ).toBe(400);
  });

  // 型別混淆的 filters 值必須是乾淨 400（AC-14.3），不可讓錯型別流進 buildPredicate 而拋 TypeError → 500。
  it('rejects type-confused filter values with 400 (never 500)', async () => {
    expect((await post({ view: 'keywords', filters: { intent: 'commercial' } })).status).toBe(400);
    expect((await post({ view: 'keywords', filters: { q: 123 } })).status).toBe(400);
    expect((await post({ view: 'keywords', filters: { competition: 'LOW' } })).status).toBe(400);
    expect((await post({ view: 'keywords', filters: { volumeMin: 'lots' } })).status).toBe(400);
    expect((await post({ view: 'keywords', filters: { bogusKey: 1 } })).status).toBe(400);
  });

  it('rejects a non-UUID id with 400 (ParseUUIDPipe)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses/not-a-uuid/query')
      .set('x-api-key', API_KEY)
      .send({ view: 'keywords' });
    expect(res.status).toBe(400);
  });
});
