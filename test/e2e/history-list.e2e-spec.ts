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
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';
import { PrismaService } from 'src/prisma';

/**
 * TC-56（FR-23，AC-23.1~23.3）：`GET /api/v1/keyword-analyses` 分析歷史清單——分頁 + `status` 過濾 +
 * `createdAt desc`；未知 status→400；`pageSize`>上限→400；未認證→401。Prisma 以忠實 mock（honour
 * where.status / orderBy createdAt desc / skip / take）驗真實分頁/過濾/排序語意。
 */
const API_KEY = 'test-api-key';

interface Row {
  id: string;
  status: string;
  seeds: string[];
  params: { mode: string; geo: string; language: string };
  createdAt: Date;
  finishedAt: Date | null;
  resultSnapshotId: string | null;
  resultSnapshot: { id: string; keywordCount: number } | null;
}

function row(id: string, status: string, day: number, snapCount: number | null): Row {
  return {
    id,
    status,
    seeds: [`seed-${id}`],
    params: { mode: 'expand', geo: 'TW', language: 'zh-TW' },
    createdAt: new Date(Date.UTC(2026, 0, day)),
    finishedAt: snapCount !== null ? new Date(Date.UTC(2026, 0, day, 1)) : null,
    resultSnapshotId: snapCount !== null ? `snap-${id}` : null,
    resultSnapshot: snapCount !== null ? { id: `snap-${id}`, keywordCount: snapCount } : null,
  };
}

// createdAt 由新到舊：a5(day5) a4 a3 a2 a1(day1)
const ROWS: Row[] = [
  row('a1', 'queued', 1, null),
  row('a2', 'completed', 2, 50),
  row('a3', 'failed', 3, null),
  row('a4', 'completed', 4, 120),
  row('a5', 'running', 5, null),
];

describe('GET /api/v1/keyword-analyses 歷史清單 (e2e · TC-56 · FR-23)', () => {
  let app: INestApplication<App>;
  let findMany: jest.Mock;
  let count: jest.Mock;

  beforeAll(async () => {
    const select = (where?: { status?: string }): Row[] => {
      const filtered = where?.status ? ROWS.filter((r) => r.status === where.status) : ROWS;
      return [...filtered].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    };
    findMany = jest.fn(
      (args: { where?: { status?: string }; skip?: number; take?: number }): Promise<Row[]> => {
        const sorted = select(args.where);
        const skip = args.skip ?? 0;
        const take = args.take ?? sorted.length;
        return Promise.resolve(sorted.slice(skip, skip + take));
      },
    );
    count = jest.fn((args: { where?: { status?: string } }): Promise<number> =>
      Promise.resolve(select(args.where).length),
    );
    const prisma = { keywordAnalysis: { findMany, count } };

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

  it('未認證 → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/keyword-analyses');
    expect(res.status).toBe(401);
  });

  it('分頁 + createdAt desc + 回應形狀', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/keyword-analyses?page=1&pageSize=2')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    const body = res.body as {
      data: Array<{
        analysisId: string;
        status: string;
        seeds: string[];
        params: { mode: string; geo: string; language: string };
        createdAt: string;
        finishedAt: string | null;
        resultSnapshotId: string | null;
        count: number | null;
      }>;
      meta: { total: number; page: number; pageSize: number };
    };
    expect(body.meta).toEqual({ total: 5, page: 1, pageSize: 2 });
    expect(body.data.map((d) => d.analysisId)).toEqual(['a5', 'a4']); // createdAt desc
    expect(body.data[0]).toMatchObject({
      analysisId: 'a5',
      status: 'running',
      seeds: ['seed-a5'],
      params: { mode: 'expand', geo: 'TW', language: 'zh-TW' },
      resultSnapshotId: null,
      count: null,
    });
    // a4 有 snapshot → count 帶回
    expect(body.data[1]).toMatchObject({
      analysisId: 'a4',
      resultSnapshotId: 'snap-a4',
      count: 120,
    });
  });

  it('status 過濾', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/keyword-analyses?status=completed')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    const body = res.body as { data: Array<{ analysisId: string }>; meta: { total: number } };
    expect(body.meta.total).toBe(2);
    expect(body.data.map((d) => d.analysisId)).toEqual(['a4', 'a2']);
  });

  it('未知 status → 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/keyword-analyses?status=bogus')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(400);
  });

  it('pageSize 超上限 → 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/keyword-analyses?pageSize=100000')
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(400);
  });

  it('越界 page → 200 空頁，不對 DB 發出越界 OFFSET 查詢（M9-R4）', async () => {
    // 真 Postgres 下 `skip=(page-1)*pageSize` 越界會 int8 溢位 → 500（且深 OFFSET 掃描＝DoS）。
    // 修正＝skip ≥ total 時短路回空頁、**不**下 findMany（故越界 OFFSET 永不抵達 DB）。
    findMany.mockClear();
    const res = await request(app.getHttpServer())
      .get('/api/v1/keyword-analyses?page=1000000000000000') // 1e15：遠超 total
      .set('x-api-key', API_KEY);

    expect(res.status).toBe(200); // 不是 500
    const body = res.body as { data: unknown[]; meta: { total: number } };
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(ROWS.length);
    expect(findMany).not.toHaveBeenCalled(); // 短路：越界 OFFSET 不下 DB（防 int8 溢位 500 / 深掃 DoS）
  });
});
