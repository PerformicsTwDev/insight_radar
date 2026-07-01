import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import type { SnapshotRowData } from 'src/keyword-analysis/result-snapshot.checksum';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';
import { PrismaService } from 'src/prisma';

const API_KEY = 'test-api-key'; // matches .env.test
const ANALYSIS_ID = '11111111-1111-1111-1111-111111111111';

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

/** 固化 snapshot 列（覆蓋 volume/competition/cpc/intent 便於驗篩選/排序/翻頁）。 */
const ROWS: SnapshotRowData[] = [
  srow({
    normalizedText: 'alpha',
    text: 'Alpha',
    avgMonthlySearches: 300,
    competition: 'HIGH',
    intent: ['commercial'],
  }),
  srow({
    normalizedText: 'bravo',
    text: 'Bravo',
    avgMonthlySearches: 100,
    competition: 'LOW',
    intent: ['informational'],
  }),
  srow({
    normalizedText: 'charlie',
    text: 'Charlie',
    avgMonthlySearches: 200,
    competition: 'LOW',
    intent: ['commercial'],
  }),
];

/** supertest `res.body`（any）的最小型別。 */
interface KeywordsBody {
  view: string;
  columns: unknown[];
  rows: { normalizedText: string }[];
  pagination: { total: number; cursor: string | null };
}
const asBody = (res: request.Response): KeywordsBody => res.body as KeywordsBody;

/**
 * TC-23：`GET /keyword-analyses/:id/keywords`。啟動完整 app，以假 prisma 提供固化 snapshot（無 DB）；
 * 驗篩選 + 排序 + keyset 分頁（列正確、翻頁穩定）+ 認證邊界。
 */
describe('GET /keyword-analyses/:id/keywords (e2e, TC-23)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const prisma = {
      keywordAnalysis: {
        findUnique: jest.fn(() => Promise.resolve({ resultSnapshotId: 'snap-1' })),
      },
      snapshotRow: {
        findMany: jest.fn(() => Promise.resolve(ROWS.map((data) => ({ data })))),
      },
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

  const url = `/api/v1/keyword-analyses/${ANALYSIS_ID}/keywords`;

  it('rejects a request without x-api-key (401)', async () => {
    const res = await request(app.getHttpServer()).get(url);
    expect(res.status).toBe(401);
  });

  it('returns the keywords view with columns + rows + pagination meta', async () => {
    const res = await request(app.getHttpServer())
      .get(url)
      .set('x-api-key', API_KEY)
      .query({ sortBy: 'avgMonthlySearches', sortDir: 'desc' });

    expect(res.status).toBe(200);
    expect(asBody(res).view).toBe('keywords');
    expect(Array.isArray(asBody(res).columns)).toBe(true);
    expect(asBody(res).rows.map((r) => r.normalizedText)).toEqual(['alpha', 'charlie', 'bravo']); // desc by volume
    expect(asBody(res).pagination.total).toBe(3);
  });

  it('applies the shared FilterSpec (competition + intent)', async () => {
    const res = await request(app.getHttpServer())
      .get(url)
      .set('x-api-key', API_KEY)
      .query({ competition: 'LOW', intent: 'commercial' });

    expect(res.status).toBe(200);
    expect(asBody(res).rows.map((r) => r.normalizedText)).toEqual(['charlie']);
  });

  it('paginates stably (keyset cursor resumes after the first page, no overlap)', async () => {
    const p1 = await request(app.getHttpServer())
      .get(url)
      .set('x-api-key', API_KEY)
      .query({ sortBy: 'avgMonthlySearches', sortDir: 'desc', pageSize: 2 });
    expect(asBody(p1).rows.map((r) => r.normalizedText)).toEqual(['alpha', 'charlie']);
    expect(asBody(p1).pagination.cursor).toBeTruthy();

    const p2 = await request(app.getHttpServer())
      .get(url)
      .set('x-api-key', API_KEY)
      .query({
        sortBy: 'avgMonthlySearches',
        sortDir: 'desc',
        pageSize: 2,
        cursor: asBody(p1).pagination.cursor,
      });
    expect(asBody(p2).rows.map((r) => r.normalizedText)).toEqual(['bravo']);
  });

  it('rejects invalid params with 400 (min>max, unknown sortDir)', async () => {
    const bad1 = await request(app.getHttpServer())
      .get(url)
      .set('x-api-key', API_KEY)
      .query({ volumeMin: 200, volumeMax: 100 });
    expect(bad1.status).toBe(400);

    const bad2 = await request(app.getHttpServer())
      .get(url)
      .set('x-api-key', API_KEY)
      .query({ sortDir: 'sideways' });
    expect(bad2.status).toBe(400);
  });

  it('rejects a non-UUID id with 400 (ParseUUIDPipe)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/keyword-analyses/not-a-uuid/keywords')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(400);
  });
});
