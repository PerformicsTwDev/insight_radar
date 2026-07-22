import { getQueueToken } from '@nestjs/bullmq';
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
import { overrideBackgroundWorkers } from './helpers/background-workers';

const API_KEY = 'test-api-key';
const ID = '77777777-7777-7777-7777-777777777777';

/** AI Search 讀取層 view（FR-44/T15.6）。前六為明細/可見度表，後三為 KPI score cards（responseShape=summary）。 */
const AI_TABLE_VIEWS = [
  'ai_answers',
  'ai_cited_media',
  'ai_cited_pages',
  'brand_ai_visibility',
  'intent_ai_visibility',
  'journey_ai_visibility',
] as const;
const AI_SUMMARY_VIEWS = [
  'brand_ai_visibility_summary',
  'intent_ai_visibility_summary',
  'journey_ai_visibility_summary',
] as const;
const ALL_AI_VIEWS = [...AI_TABLE_VIEWS, ...AI_SUMMARY_VIEWS];

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

interface ErrBody {
  code?: string;
  rows?: unknown[];
}
interface SelectField {
  key: string;
  type: 'text' | 'number' | 'array';
}
interface ViewMeta {
  name: string;
  grain: string;
  allowedSelect: SelectField[];
  allowedFilters: string[];
  allowedSort: string[];
  responseShape: string;
  requiresFeature: string;
}

/**
 * TC-80（FR-44 · AC-44.1/44.2/44.3）：AI Search 讀取層 view 註冊 + gating + `GET /views` 自省。
 *
 * 六類 view（`ai_answers`/`ai_cited_media`/`ai_cited_pages`/`brand|intent|journey_ai_visibility`）+ 對應
 * `*_summary`（KPI score cards）皆經既有 `POST /keyword-analyses/:id/query` primitive（**無專屬 endpoint**，INV-1）
 * 讀取；本 task 為 forward-compatible **gated placeholder** 註冊——依賴 `ai_search` feature（compute 未接線 →
 * `not_generated`），故 not-ready 時回 **409 `FEATURE_NOT_READY`**（非誤導空表、非 500，INV-6），實際查 T15.5
 * 落庫之 `build` 屬後續 slice（#678）。`GET /views` **自動**含新 view（NFR-10 閉環）。
 */
describe('AI Search views registration + gating (e2e, TC-80)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const prisma = {
      keywordAnalysis: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            status: 'completed',
            resultSnapshotId: 'snap-1',
            ownerId: null,
            progress: { phase: 'done', percent: 100 },
            resultSnapshot: { id: 'snap-1', keywordCount: 1 },
          }),
        ),
      },
      snapshotRow: {
        findMany: jest.fn(() => Promise.resolve([{ data: srow({ normalizedText: 'a' }) }])),
      },
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

  const post = (body: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/keyword-analyses/${ID}/query`)
      .set('x-api-key', API_KEY)
      .send(body);

  it('GET /:id reports ai_search feature as not_generated (compute not wired, T15.6)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/keyword-analyses/${ID}`)
      .set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(
      (res.body as { features?: Record<string, { status: string }> }).features?.ai_search,
    ).toEqual({ status: 'not_generated' });
  });

  it.each(ALL_AI_VIEWS)(
    'POST /query {view:%s} → 409 FEATURE_NOT_READY (gated, not a misleading empty table, not 500)',
    async (view) => {
      const res = await post({ view });
      expect(res.status).toBe(409);
      const body = res.body as ErrBody;
      expect(body.code).toBe('FEATURE_NOT_READY');
      expect(body.rows).toBeUndefined(); // 不回空表
    },
  );

  it('base keyword_metrics view still returns 200 (AI feature key does not gate existing views)', async () => {
    const res = await post({ view: 'keywords' });
    expect(res.status).toBe(200);
    expect((res.body as ErrBody).rows).toHaveLength(1);
  });

  it('GET /views auto-includes all AI Search views with ai_search feature + correct responseShape (NFR-10)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/views').set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    const views = (res.body as { views: ViewMeta[] }).views;
    const byName = new Map(views.map((v) => [v.name, v]));

    for (const name of ALL_AI_VIEWS) {
      const meta = byName.get(name);
      expect(meta).toBeDefined();
      expect(meta?.requiresFeature).toBe('ai_search');
      // 統一 FilterSpec：allowedFilters 與既有 keyword view 同一份 FILTER_KEYS（非另抄）。
      expect(meta?.allowedFilters).toContain('volumeMin');
      expect(meta?.allowedFilters).toContain('intent');
    }
    for (const name of AI_TABLE_VIEWS) {
      expect(byName.get(name)?.responseShape).toBe('table');
    }
    for (const name of AI_SUMMARY_VIEWS) {
      expect(byName.get(name)?.responseShape).toBe('summary');
    }
    // 明細/可見度表帶 typed allowedSelect（供前端 codegen）；summary 為單列 KPI，無 select 欄位。
    expect(byName.get('ai_answers')?.allowedSelect.find((f) => f.key === 'positive')?.type).toBe(
      'number',
    );
    expect(byName.get('ai_answers')?.allowedSelect.find((f) => f.key === 'brands')?.type).toBe(
      'array',
    );
    expect(
      byName.get('brand_ai_visibility')?.allowedSelect.find((f) => f.key === 'shareOfVoice')?.type,
    ).toBe('number');
    expect(byName.get('brand_ai_visibility_summary')?.allowedSelect).toEqual([]);
  });
});
