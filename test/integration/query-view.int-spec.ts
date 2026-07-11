import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from 'src/common/authenticated-user';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FeatureNotReadyException } from 'src/keywords/feature-not-ready.exception';
import { NotReadyException } from 'src/keywords/not-ready.exception';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { queryConfig } from 'src/config/query.config';
import type { SnapshotRowData } from 'src/keyword-analysis/result-snapshot.checksum';
import { KeywordsModule } from 'src/keywords/keywords.module';
import { SnapshotQueryService } from 'src/keywords/snapshot-query.service';
import type { ChartViewResult, TableViewResult, TrendViewResult } from 'src/keywords/views';
import { PrismaService } from 'src/prisma';

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

/** 機器 actor（x-api-key）：不套 owner 過濾——此檔驗 view-router 語意（非 owner），用機器身分。 */
const API_ACTOR: AuthenticatedUser = { kind: 'apiKey' };

describe('query-view integration (T5.5 / TC-36 / FR-14 · Testcontainers)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: SnapshotQueryService;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // queryConfig 讀 env（此測試不跑 Joi）→ 先設上限值，讓 pageSize>max / bounds 檢查有意義。
    // 先快照原值，afterAll 還原——`--runInBand` 下不可洩漏給後續 int-spec（M5-R3）。
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
    // 還原 env（原無則刪、原有則復原）→ 不污染共用 process 的其他整合測試。
    for (const key of LIMIT_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  afterEach(async () => {
    await prisma.snapshotRow.deleteMany();
    await prisma.keywordAnalysis.updateMany({ data: { resultSnapshotId: null } });
    await prisma.resultSnapshot.deleteMany();
    await prisma.keywordAnalysis.deleteMany();
  });

  /** 建 completed analysis + 不可變 snapshot（rowIndex 序）於真實 Postgres，回 analysisId。 */
  async function seedSnapshot(rows: SnapshotRowData[]): Promise<string> {
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

  it('routes the keywords view over a real snapshot (filter/sort/paginate)', async () => {
    const id = await seedSnapshot([
      srow({ normalizedText: 'a', avgMonthlySearches: 300 }),
      srow({ normalizedText: 'b', avgMonthlySearches: 100 }),
    ]);
    const res = (await service.query(
      id,
      { view: 'keywords', sort: [{ field: 'avgMonthlySearches', direction: 'desc' }] },
      API_ACTOR,
    )) as TableViewResult;
    expect(res.view).toBe('keywords');
    expect(res.rows.map((r) => r.normalizedText)).toEqual(['a', 'b']); // desc
    expect(res.pagination.total).toBe(2);
  });

  it('routes the trend view (month axis + total from persisted monthlyVolumes)', async () => {
    const id = await seedSnapshot([
      srow({ normalizedText: 'a', monthlyVolumes: [{ year: 2026, month: 1, searches: 100 }] }),
      srow({ normalizedText: 'b', monthlyVolumes: [{ year: 2026, month: 2, searches: 50 }] }),
    ]);
    const res = (await service.query(id, { view: 'trend' }, API_ACTOR)) as TrendViewResult;
    expect(res.axis).toEqual(['2026-01', '2026-02']);
    expect(res.total).toEqual([100, 50]);
  });

  it('routes the intent_distribution chart view (explosion)', async () => {
    const id = await seedSnapshot([
      srow({ normalizedText: 'a', intent: ['commercial'] }),
      srow({ normalizedText: 'b', intent: ['commercial', 'informational'] }),
    ]);
    const res = (await service.query(
      id,
      { view: 'intent_distribution' },
      API_ACTOR,
    )) as ChartViewResult;
    expect(res.groups.find((g) => g.key.intentLabel === 'commercial')?.measures.count).toBe(2);
  });

  it('routes the cpc_histogram chart view (bucketing)', async () => {
    const id = await seedSnapshot([
      srow({ normalizedText: 'a', cpcLow: 0.5 }),
      srow({ normalizedText: 'b', cpcLow: 1.5 }),
    ]);
    const res = (await service.query(id, { view: 'cpc_histogram' }, API_ACTOR)) as ChartViewResult;
    expect(res.groups.find((g) => g.key.bucket === 0)?.measures.count).toBe(1);
    expect(res.groups.find((g) => g.key.bucket === 1)?.measures.count).toBe(1);
  });

  it('rejects an unknown view / pageSize over max / min>max with 400', async () => {
    const id = await seedSnapshot([srow()]);
    await expect(service.query(id, { view: 'nope' }, API_ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.query(id, { view: 'keywords', pagination: { pageSize: 5000 } }, API_ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.query(
        id,
        { view: 'keywords', filters: { volumeMin: 200, volumeMax: 100 } },
        API_ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 404 for an unknown analysis id (AC-6.5)', async () => {
    await expect(
      service.query(randomUUID(), { view: 'keywords' }, API_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws 409 NOT_READY for a running analysis with no snapshot yet (AC-6.4)', async () => {
    const id = randomUUID();
    await prisma.keywordAnalysis.create({
      data: {
        id,
        status: 'running',
        seeds: [],
        params: {},
        progress: {},
        idempotencyKey: `idem-${id}`,
      },
    });
    await expect(service.query(id, { view: 'keywords' }, API_ACTOR)).rejects.toBeInstanceOf(
      NotReadyException,
    );
  });

  it('feature-gates a view whose compute is not generated → FEATURE_NOT_READY (TC-53 / AC-14.7)', async () => {
    // 完成的 keyword 分析（snapshot 就緒）但 serp/topics compute 未產生 → serp_questions/intent_topics 被 gate。
    const id = await seedSnapshot([srow()]);
    await expect(service.query(id, { view: 'serp_questions' }, API_ACTOR)).rejects.toBeInstanceOf(
      FeatureNotReadyException,
    );
    await expect(service.query(id, { view: 'intent_topics' }, API_ACTOR)).rejects.toBeInstanceOf(
      FeatureNotReadyException,
    );
    // 基底 keyword_metrics view（snapshot 就緒）不 gate → 正常回結果。
    const ok = (await service.query(id, { view: 'keywords' }, API_ACTOR)) as TableViewResult;
    expect(ok.view).toBe('keywords');
  });

  it('round-trips null metrics through jsonb (缺值≠0) and skips them in the histogram', async () => {
    const id = await seedSnapshot([
      srow({ normalizedText: 'has', cpcLow: 1.5, avgMonthlySearches: 100 }),
      srow({ normalizedText: 'none', cpcLow: null, avgMonthlySearches: null }),
    ]);
    // keywords：null 指標經 jsonb 原樣還原（非被補 0）。
    const kw = (await service.query(
      id,
      { view: 'keywords', sort: [{ field: 'text', direction: 'asc' }] },
      API_ACTOR,
    )) as TableViewResult;
    const noneRow = kw.rows.find((r) => r.normalizedText === 'none');
    expect(noneRow?.avgMonthlySearches).toBeNull();
    expect(noneRow?.cpcLow).toBeNull();
    // cpc_histogram：null cpc 不落桶（只計 'has'）。
    const hist = (await service.query(id, { view: 'cpc_histogram' }, API_ACTOR)) as ChartViewResult;
    expect(hist.groups.every((g) => typeof g.key.bucket === 'number')).toBe(true);
    expect(hist.groups.reduce((sum, g) => sum + (g.measures.count ?? 0), 0)).toBe(1);
  });
});
