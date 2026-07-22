import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/authenticated-user';
import { queryConfig } from 'src/config/query.config';
import type { SnapshotRowData } from 'src/keyword-analysis/result-snapshot.checksum';
import { FeatureNotReadyException } from 'src/keywords/feature-not-ready.exception';
import { KeywordsModule } from 'src/keywords/keywords.module';
import { SnapshotQueryService } from 'src/keywords/snapshot-query.service';
import type { SummaryViewResult, TableViewResult } from 'src/keywords/views';
import { PrismaService } from 'src/prisma';

/**
 * TC-80 (T15.8b / #678 G2+G3 · FR-44/AC-44.2 · FR-43/AC-43.3 · Testcontainers)：AI Search 讀取層 view
 * `build()` 實讀 T15.5 落庫（`ai_answers`/`ai_cited_references`/`ai_visibility_metrics`，keyed by 最新
 * completed linked `AiSearchRun.id`）+ query 路徑 gate 隨真實資料翻轉（ready→真資料 200；not-ready→續 409
 * `FEATURE_NOT_READY`，非誤導空表 INV-6）+ intent/journey 維度 view 讀 dimension 篩選列（G3 組裝，AC-43.3）
 * + 統一 `FilterSpec` 過濾生效。Postgres＝真 Testcontainers。
 */

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

const LIMIT_ENV_KEYS = ['QUERY_MAX_PAGE_SIZE', 'AGG_MAX_BUCKETS', 'AGG_MAX_GROUPS'] as const;

/** 機器 actor（x-api-key）：不套 owner 過濾（此檔驗讀取層語意，非 owner）。 */
const API_ACTOR: AuthenticatedUser = { kind: 'apiKey' };

interface AnswerSeed {
  channel: string;
  query: string;
  answerText: string;
  brands: string[];
  positive: number;
  negative: number;
}
interface CitedSeed {
  channel: string;
  query: string;
  link: string;
  domain: string;
  title: string | null;
  mediaType: string;
}
interface MetricSeed {
  channel: string;
  dimension: string;
  groupKey: string;
  brand: string;
  mentions: number;
  shareOfVoice: number | null;
  citations: number;
  exposure: number | null;
}

describe('AI Search view build + gate flip (integration, TC-80 · #678 G2/G3)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: SnapshotQueryService;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of LIMIT_ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    process.env.QUERY_MAX_PAGE_SIZE = '200';
    process.env.AGG_MAX_BUCKETS = '200';
    process.env.AGG_MAX_GROUPS = '1000';
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [queryConfig] }), KeywordsModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(SnapshotQueryService);
  });

  afterAll(async () => {
    await moduleRef.close();
    for (const key of LIMIT_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM ai_visibility_metrics');
    await prisma.$executeRawUnsafe('DELETE FROM ai_cited_references');
    await prisma.$executeRawUnsafe('DELETE FROM ai_answers');
    await prisma.$executeRawUnsafe('DELETE FROM ai_search_runs');
    await prisma.snapshotRow.deleteMany();
    await prisma.keywordAnalysis.updateMany({ data: { resultSnapshotId: null } });
    await prisma.resultSnapshot.deleteMany();
    await prisma.keywordAnalysis.deleteMany();
  });

  /** 建 completed analysis + 不可變 snapshot（rowIndex 序），回 analysisId。 */
  async function seedAnalysis(rows: SnapshotRowData[]): Promise<string> {
    const analysisId = randomUUID();
    const snapshotId = randomUUID();
    await prisma.keywordAnalysis.create({
      data: {
        id: analysisId,
        status: 'running',
        seeds: [],
        params: {},
        progress: {},
        idempotencyKey: `idem-${analysisId}`,
      },
    });
    await prisma.resultSnapshot.create({
      data: { id: snapshotId, analysisId, keywordCount: rows.length, checksum: 'x' },
    });
    await prisma.snapshotRow.createMany({
      data: rows.map((data, rowIndex) => ({
        snapshotId,
        analysisId,
        rowIndex,
        data: data as unknown as Prisma.InputJsonValue,
      })),
    });
    await prisma.keywordAnalysis.update({
      where: { id: analysisId },
      data: { status: 'completed', resultSnapshotId: snapshotId },
    });
    return analysisId;
  }

  /** 建 AI Search run（linked 至 analysis），回 runId=jobId。 */
  async function seedRun(analysisId: string | null, status: string): Promise<string> {
    const runId = randomUUID();
    await prisma.aiSearchRun.create({
      data: {
        id: runId,
        ownerId: null,
        keywordAnalysisId: analysisId,
        status,
        params: {},
        progress: {},
        idempotencyKey: `run-idem-${runId}`,
      },
    });
    return runId;
  }

  async function seedAiTables(
    jobId: string,
    data: { answers?: AnswerSeed[]; cited?: CitedSeed[]; metrics?: MetricSeed[] },
  ): Promise<void> {
    if (data.answers?.length) {
      await prisma.aiAnswer.createMany({
        data: data.answers.map((a) => ({ ownerId: null, jobId, schemaVersion: 'v1', ...a })),
      });
    }
    if (data.cited?.length) {
      await prisma.aiCitedReference.createMany({
        data: data.cited.map((c) => ({ ownerId: null, jobId, schemaVersion: 'v1', ...c })),
      });
    }
    if (data.metrics?.length) {
      await prisma.aiVisibilityMetric.createMany({
        data: data.metrics.map((m) => ({ ownerId: null, jobId, schemaVersion: 'v1', ...m })),
      });
    }
  }

  it('ai_answers: ready (completed linked run) → 讀 ai_answers 真資料（非 409、非空表）', async () => {
    const id = await seedAnalysis([srow()]);
    const jobId = await seedRun(id, 'completed');
    await seedAiTables(jobId, {
      answers: [
        {
          channel: 'chatGpt',
          query: 'asus zenbook',
          answerText: 'ASUS ZenBook is great',
          brands: ['ASUS', 'ASUS'],
          positive: 2,
          negative: 0,
        },
      ],
    });
    const res = (await service.query(id, { view: 'ai_answers' }, API_ACTOR)) as TableViewResult;
    expect(res.view).toBe('ai_answers');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      channel: 'chatGpt',
      query: 'asus zenbook',
      brands: ['ASUS', 'ASUS'],
      positive: 2,
    });
    expect(res.pagination.total).toBe(1);
  });

  it('ai_cited_pages: 讀 ai_cited_references 逐頁列表', async () => {
    const id = await seedAnalysis([srow()]);
    const jobId = await seedRun(id, 'completed');
    await seedAiTables(jobId, {
      cited: [
        {
          channel: 'chatGpt',
          query: 'asus zenbook',
          link: 'https://asus.com/zenbook',
          domain: 'asus.com',
          title: 'ASUS official',
          mediaType: 'retail',
        },
      ],
    });
    const res = (await service.query(id, { view: 'ai_cited_pages' }, API_ACTOR)) as TableViewResult;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ domain: 'asus.com', mediaType: 'retail' });
  });

  it('ai_cited_media: 依 media_type 聚合佔比（count + share）', async () => {
    const id = await seedAnalysis([srow()]);
    const jobId = await seedRun(id, 'completed');
    await seedAiTables(jobId, {
      cited: [
        {
          channel: 'chatGpt',
          query: 'q',
          link: 'a',
          domain: 'a.com',
          title: null,
          mediaType: 'retail',
        },
        {
          channel: 'chatGpt',
          query: 'q',
          link: 'b',
          domain: 'b.com',
          title: null,
          mediaType: 'retail',
        },
        {
          channel: 'chatGpt',
          query: 'q',
          link: 'c',
          domain: 'c.com',
          title: null,
          mediaType: 'news',
        },
      ],
    });
    const res = (await service.query(id, { view: 'ai_cited_media' }, API_ACTOR)) as TableViewResult;
    const retail = res.rows.find((r) => r.mediaType === 'retail');
    const news = res.rows.find((r) => r.mediaType === 'news');
    expect(retail?.count).toBe(2);
    expect(retail?.share).toBeCloseTo(2 / 3);
    expect(news?.count).toBe(1);
  });

  it('brand_ai_visibility: 讀 ai_visibility_metrics（dimension=keyword）', async () => {
    const id = await seedAnalysis([srow()]);
    const jobId = await seedRun(id, 'completed');
    await seedAiTables(jobId, {
      metrics: [
        {
          channel: 'chatGpt',
          dimension: 'keyword',
          groupKey: 'asus zenbook',
          brand: 'ASUS',
          mentions: 3,
          shareOfVoice: 0.75,
          citations: 1,
          exposure: null,
        },
      ],
    });
    const res = (await service.query(
      id,
      { view: 'brand_ai_visibility' },
      API_ACTOR,
    )) as TableViewResult;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ brand: 'ASUS', mentions: 3, shareOfVoice: 0.75 });
  });

  it('intent_ai_visibility / journey_ai_visibility: 讀對應 dimension 列（G3 維度，非結構性空）', async () => {
    const id = await seedAnalysis([srow()]);
    const jobId = await seedRun(id, 'completed');
    await seedAiTables(jobId, {
      metrics: [
        {
          channel: 'chatGpt',
          dimension: 'intent',
          groupKey: 'commercial',
          brand: 'ASUS',
          mentions: 2,
          shareOfVoice: 1,
          citations: 0,
          exposure: null,
        },
        {
          channel: 'chatGpt',
          dimension: 'journey',
          groupKey: 'consideration',
          brand: 'ASUS',
          mentions: 1,
          shareOfVoice: 1,
          citations: 0,
          exposure: null,
        },
        // keyword 維度列不得洩漏進 intent/journey view（dimension 篩選）。
        {
          channel: 'chatGpt',
          dimension: 'keyword',
          groupKey: 'asus',
          brand: 'ASUS',
          mentions: 5,
          shareOfVoice: 1,
          citations: 0,
          exposure: null,
        },
      ],
    });
    const intent = (await service.query(
      id,
      { view: 'intent_ai_visibility' },
      API_ACTOR,
    )) as TableViewResult;
    expect(intent.rows).toHaveLength(1);
    expect(intent.rows[0]).toMatchObject({ groupKey: 'commercial', mentions: 2 });

    const journey = (await service.query(
      id,
      { view: 'journey_ai_visibility' },
      API_ACTOR,
    )) as TableViewResult;
    expect(journey.rows).toHaveLength(1);
    expect(journey.rows[0]).toMatchObject({ groupKey: 'consideration', mentions: 1 });
  });

  it('brand_ai_visibility_summary: 聚合 KPI（dimension=keyword）', async () => {
    const id = await seedAnalysis([srow()]);
    const jobId = await seedRun(id, 'completed');
    await seedAiTables(jobId, {
      metrics: [
        {
          channel: 'chatGpt',
          dimension: 'keyword',
          groupKey: 'asus',
          brand: 'ASUS',
          mentions: 3,
          shareOfVoice: 0.6,
          citations: 2,
          exposure: null,
        },
        {
          channel: 'chatGpt',
          dimension: 'keyword',
          groupKey: 'asus',
          brand: 'Acer',
          mentions: 2,
          shareOfVoice: 0.4,
          citations: 0,
          exposure: null,
        },
      ],
    });
    const res = (await service.query(
      id,
      { view: 'brand_ai_visibility_summary' },
      API_ACTOR,
    )) as SummaryViewResult;
    expect(res.view).toBe('brand_ai_visibility_summary');
    expect(res.metrics.mentions).toBe(5);
    expect(res.metrics.citations).toBe(2);
  });

  it('FilterSpec 過濾生效：q 過濾 ai_answers 的 query 文字', async () => {
    const id = await seedAnalysis([srow()]);
    const jobId = await seedRun(id, 'completed');
    await seedAiTables(jobId, {
      answers: [
        {
          channel: 'chatGpt',
          query: 'asus zenbook',
          answerText: 'x',
          brands: [],
          positive: 0,
          negative: 0,
        },
        {
          channel: 'chatGpt',
          query: 'macbook air',
          answerText: 'y',
          brands: [],
          positive: 0,
          negative: 0,
        },
      ],
    });
    const res = (await service.query(
      id,
      { view: 'ai_answers', filters: { q: 'zenbook' } },
      API_ACTOR,
    )) as TableViewResult;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].query).toBe('asus zenbook');
  });

  it('gate 翻轉（not-ready）：無 linked run → 409 FEATURE_NOT_READY（非空表）', async () => {
    const id = await seedAnalysis([srow()]);
    await expect(service.query(id, { view: 'ai_answers' }, API_ACTOR)).rejects.toBeInstanceOf(
      FeatureNotReadyException,
    );
  });

  it('gate 翻轉（not-ready）：linked run 仍 running → 409（未就緒不回空表）', async () => {
    const id = await seedAnalysis([srow()]);
    await seedRun(id, 'running');
    await expect(
      service.query(id, { view: 'brand_ai_visibility' }, API_ACTOR),
    ).rejects.toBeInstanceOf(FeatureNotReadyException);
  });

  it('gate ready（partial linked run 亦 ready）：讀 partial run 已落庫的資料', async () => {
    const id = await seedAnalysis([srow()]);
    const jobId = await seedRun(id, 'partial');
    await seedAiTables(jobId, {
      answers: [
        {
          channel: 'chatGpt',
          query: 'q',
          answerText: 'a',
          brands: ['ASUS'],
          positive: 0,
          negative: 0,
        },
      ],
    });
    const res = (await service.query(id, { view: 'ai_answers' }, API_ACTOR)) as TableViewResult;
    expect(res.rows).toHaveLength(1);
  });
});
