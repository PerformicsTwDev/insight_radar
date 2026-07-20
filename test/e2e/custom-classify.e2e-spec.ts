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
const ROWS: SnapshotRowData[] = [
  srow({ normalizedText: 'buy running shoes', text: 'buy running shoes' }),
  srow({ normalizedText: 'running shoes review', text: 'running shoes review' }),
];

/** LLM 完成的 openai 形狀（fake AZURE_OPENAI_CLIENT.chat.completions.parse 回傳）。 */
type Label = { label: string; description: string };
type Completion = {
  choices: { message: { parsed: { labels: Label[] } | null; refusal: string | null } }[];
};
const okCompletion = (labels: Label[]): Completion => ({
  choices: [{ message: { parsed: { labels }, refusal: null } }],
});
const refusalCompletion: Completion = {
  choices: [{ message: { parsed: null, refusal: 'content_filter' } }],
};

interface CustomClassifyBody {
  id: string;
  name: string;
  instruction: string;
  labels: Label[];
  createdAt: string;
}
const asBody = (res: request.Response): CustomClassifyBody => res.body as CustomClassifyBody;

/**
 * TC-70：`POST /keyword-analyses/:id/custom-classifications`（T12.7，FR-34 / AC-34.1）。啟動完整 app，以假
 * prisma 提供 owner/readiness + snapshot 樣本 + 落庫，以假 AZURE_OPENAI_CLIENT 控制 LLM 標籤（無真 Azure/Redis）；
 * 驗 201 happy、400（空欄位 / 非 UUID / whitelist 拒未知欄位）、409（未就緒）、404（未知 id）、401、502（LLM 失敗）。
 */
describe('POST /keyword-analyses/:id/custom-classifications (e2e, TC-70)', () => {
  let app: INestApplication<App>;
  const parse = jest.fn<Promise<Completion>, [unknown]>();
  const create = jest.fn<Promise<{ id: string; createdAt: Date }>, [unknown]>();

  beforeAll(async () => {
    parse.mockResolvedValue(
      okCompletion([
        { label: 'transactional', description: 'buy intent' },
        { label: 'informational', description: 'research intent' },
      ]),
    );
    create.mockImplementation(() =>
      Promise.resolve({ id: 'cc-1', createdAt: new Date('2026-07-17T14:00:00.000Z') }),
    );

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
      snapshotRow: { findMany: jest.fn(() => Promise.resolve(ROWS.map((data) => ({ data })))) },
      customClassification: { create },
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

  const url = (id: string) => `/api/v1/keyword-analyses/${id}/custom-classifications`;
  const post = (id: string, body: object) =>
    request(app.getHttpServer()).post(url(id)).set('x-api-key', API_KEY).send(body);

  it('rejects a request without x-api-key (401)', async () => {
    const res = await request(app.getHttpServer())
      .post(url(READY_ID))
      .send({ name: 'N', instruction: 'i' });
    expect(res.status).toBe(401);
  });

  it('AC-34.1: returns 201 { id, name, instruction, labels, createdAt } for a ready snapshot', async () => {
    const res = await post(READY_ID, { name: 'Funnel', instruction: 'group by purchase intent' });

    expect(res.status).toBe(201);
    expect(asBody(res).id).toBe('cc-1');
    expect(asBody(res).name).toBe('Funnel');
    expect(asBody(res).instruction).toBe('group by purchase intent');
    expect(asBody(res).labels).toEqual([
      { label: 'transactional', description: 'buy intent' },
      { label: 'informational', description: 'research intent' },
    ]);
    expect(Number.isNaN(Date.parse(asBody(res).createdAt))).toBe(false);
  });

  it('rejects an empty instruction → 400 (IsNotEmpty)', async () => {
    const res = await post(READY_ID, { name: 'N', instruction: '' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown field → 400 (global whitelist forbidNonWhitelisted)', async () => {
    const res = await post(READY_ID, { name: 'N', instruction: 'i', labels: ['x'] });
    expect(res.status).toBe(400);
  });

  it('rejects a non-UUID id → 400 (ParseUUIDPipe, not Prisma P2023 → 500)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses/not-a-uuid/custom-classifications')
      .set('x-api-key', API_KEY)
      .send({ name: 'N', instruction: 'i' });
    expect(res.status).toBe(400);
  });

  it('AC-34.1: a not-ready snapshot → 409', async () => {
    const res = await post(NOT_READY_ID, { name: 'N', instruction: 'i' });
    expect(res.status).toBe(409);
  });

  it('AC-34.1: an unknown / non-owner analysis id → 404', async () => {
    const res = await post(MISSING_ID, { name: 'N', instruction: 'i' });
    expect(res.status).toBe(404);
  });

  it('AC-34.1: an LLM failure → 502 (CUSTOM_CLASSIFY_GENERATION_FAILED), never a half-result 201', async () => {
    parse.mockResolvedValueOnce(refusalCompletion);
    const res = await post(READY_ID, { name: 'N', instruction: 'refuse me' });

    expect(res.status).toBe(502);
    expect((res.body as { code?: string }).code).toBe('CUSTOM_CLASSIFY_GENERATION_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('content_filter'); // 不外洩上游細節
  });
});
