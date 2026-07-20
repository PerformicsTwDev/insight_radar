import { getQueueToken } from '@nestjs/bullmq';
import { overrideBackgroundWorkers } from './helpers/background-workers';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import { AZURE_OPENAI_CLIENT } from 'src/intent/intent-labeler.port';
import type { SnapshotRowData } from 'src/keyword-analysis/result-snapshot.checksum';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';
import { PrismaService } from 'src/prisma';

const API_KEY = 'test-api-key'; // matches .env.test
const READY_ID = '33333333-3333-3333-3333-333333333333';
const NOT_READY_ID = '44444444-4444-4444-4444-444444444444';
const MISSING_ID = '55555555-5555-5555-5555-555555555555';

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
const ROWS: SnapshotRowData[] = [srow({ normalizedText: 'a', text: 'Alpha' })];

/** LLM 完成的 openai 形狀（fake AZURE_OPENAI_CLIENT.chat.completions.parse 回傳）。 */
type Completion = {
  choices: { message: { parsed: { insight: string } | null; refusal: string | null } }[];
};
const okCompletion = (insight: string): Completion => ({
  choices: [{ message: { parsed: { insight }, refusal: null } }],
});
const refusalCompletion: Completion = {
  choices: [{ message: { parsed: null, refusal: 'content_filter' } }],
};

interface AiInsightBody {
  view: string;
  insight: string;
  generatedAt: string;
}
const asBody = (res: request.Response): AiInsightBody => res.body as AiInsightBody;

/**
 * TC-68：`POST /keyword-analyses/:id/ai-insight`（T12.4，FR-32 / AC-32.1/32.3/32.4）。啟動完整 app，以假
 * prisma 提供 owner/readiness + snapshot 列，以假 AZURE_OPENAI_CLIENT 控制 LLM 輸出（無真 Azure/Redis）；
 * 驗 200 happy、400（unknown-view / 非 UUID / whitelist 拒 select）、409（未就緒）、404（未知 id）、401、
 * 502（LLM 失敗）。
 */
describe('POST /keyword-analyses/:id/ai-insight (e2e, TC-68)', () => {
  let app: INestApplication<App>;
  const parse = jest.fn<Promise<Completion>, [unknown]>();
  const srFindMany = jest.fn(() => Promise.resolve(ROWS.map((data) => ({ data }))));

  beforeAll(async () => {
    parse.mockResolvedValue(okCompletion('Brand terms dominate this view.'));

    const findUnique = jest.fn((args: { where: { id: string } }) => {
      switch (args.where.id) {
        case READY_ID:
          return Promise.resolve({
            status: 'completed',
            resultSnapshotId: 'snap-1',
            ownerId: null,
          });
        case NOT_READY_ID:
          return Promise.resolve({ status: 'running', resultSnapshotId: null, ownerId: null });
        default:
          return Promise.resolve(null); // 未知 id → 404
      }
    });
    const prisma = {
      keywordAnalysis: { findUnique },
      snapshotRow: { findMany: srFindMany },
    };
    const azureClient = { chat: { completions: { parse } } };

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
      .overrideProvider(AZURE_OPENAI_CLIENT)
      .useValue(azureClient)
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

  const url = (id: string) => `/api/v1/keyword-analyses/${id}/ai-insight`;
  const post = (id: string, body: object) =>
    request(app.getHttpServer()).post(url(id)).set('x-api-key', API_KEY).send(body);

  it('rejects a request without x-api-key (401)', async () => {
    const res = await request(app.getHttpServer()).post(url(READY_ID)).send({ view: 'keywords' });
    expect(res.status).toBe(401);
  });

  it('AC-32.1: returns 200 { view, insight, generatedAt } for a ready snapshot', async () => {
    const res = await post(READY_ID, { view: 'keywords', filters: { q: 'brand' } });

    expect(res.status).toBe(200);
    expect(asBody(res).view).toBe('keywords');
    expect(asBody(res).insight).toBe('Brand terms dominate this view.');
    expect(Number.isNaN(Date.parse(asBody(res).generatedAt))).toBe(false);
  });

  it('AC-32.3: an unknown view → 400 (view whitelist, reused single point)', async () => {
    const res = await post(READY_ID, { view: 'no-such-view' });
    expect(res.status).toBe(400);
  });

  it('AC-32.1 contract (#476): a body with select is rejected 400 (global whitelist)', async () => {
    // select 已從 AI-insight 契約移除（聚合須 filters-determined）；未宣告欄位由 forbidNonWhitelisted 擋。
    const res = await post(READY_ID, { view: 'keywords', select: ['text'] });
    expect(res.status).toBe(400);
  });

  it('rejects a non-UUID id → 400 (ParseUUIDPipe, not Prisma P2023 → 500)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses/not-a-uuid/ai-insight')
      .set('x-api-key', API_KEY)
      .send({ view: 'keywords' });
    expect(res.status).toBe(400);
  });

  it('AC-32.3: a not-ready snapshot → 409', async () => {
    const res = await post(NOT_READY_ID, { view: 'keywords' });
    expect(res.status).toBe(409);
  });

  it('AC-32.3: an unknown / non-owner analysis id → 404', async () => {
    const res = await post(MISSING_ID, { view: 'keywords' });
    expect(res.status).toBe(404);
  });

  it('AC-32.4: an LLM failure → 502 (AI_INSIGHT_GENERATION_FAILED), never a half-summary 200', async () => {
    parse.mockResolvedValueOnce(refusalCompletion);
    // 用不同 filters → 不同 cache key，與 happy-path 快取隔離。
    const res = await post(READY_ID, { view: 'keywords', filters: { q: 'refuse' } });

    expect(res.status).toBe(502);
    expect((res.body as { code?: string }).code).toBe('AI_INSIGHT_GENERATION_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('content_filter'); // 不外洩上游細節
  });

  it('#516/M12-R2: a table view over the page cap discloses top-N/M coverage to the LLM (full stack)', async () => {
    // 201 rows through the REAL QueryViewService/selectPage → paginated to the 200 cap → pagination.total
    // 201 > shown 200 → buildAiInsightMessages injects the Coverage note; assert it reaches the LLM.
    const bigRows = Array.from({ length: 201 }, (_, i) =>
      srow({ normalizedText: `k${i}`, text: `kw ${i}`, avgMonthlySearches: 201 - i }),
    );
    srFindMany.mockResolvedValueOnce(bigRows.map((data) => ({ data })));
    parse.mockClear();
    parse.mockResolvedValueOnce(okCompletion('big-view summary'));

    // volumeMin:1 matches all 201 rows (avgMonthlySearches 1..201) + a distinct cache key vs other tests.
    await post(READY_ID, { view: 'keywords', filters: { volumeMin: 1 } }).expect(200);

    const call = parse.mock.calls[0][0] as { messages: { role: string; content: string }[] };
    const user = call.messages.find((m) => m.role === 'user');
    expect(user?.content).toContain('Coverage:'); // honest bound disclosed end-to-end
    expect(user?.content).toContain('201'); // total M through the real view-router
  });
});
