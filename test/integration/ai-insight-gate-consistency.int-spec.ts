import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { CacheModule } from 'src/cache/cache.module';
import { CacheService } from 'src/cache/cache.service';
import type { AuthenticatedUser } from 'src/common/authenticated-user';
import { cacheConfig } from 'src/config/cache.config';
import { queryConfig } from 'src/config/query.config';
import type { SnapshotRowData } from 'src/keyword-analysis/result-snapshot.checksum';
import { FeatureNotReadyException } from 'src/keywords/feature-not-ready.exception';
import { KeywordsModule } from 'src/keywords/keywords.module';
import { SnapshotQueryService } from 'src/keywords/snapshot-query.service';
import { PrismaService } from 'src/prisma';
import type {
  IntentLabeler,
  ParseChatParams,
  ParseChatResult,
} from 'src/intent/intent-labeler.port';
import { AiInsightService, type AiInsightConfig } from 'src/ai-insight/ai-insight.service';

/**
 * TC-80 / AC-32.2 / AC-44.2 / §18.7 S25.1（M15-R13 · Testcontainers 真 Postgres）—— **AI-insight cache
 * dataVersion 必與 ai_search gate 解析同一 run**（M15-R11 dataVersion 修的 regression、gate-exit round-2 揪出）。
 *
 * AI-search idempotency key（`ai-search-idempotency.ts`）含 keywords/channels/brandProfileId、**排除 analysisId**
 * → **一 keyword-analysis 可累積多個 linked `AiSearchRun`**（不同關鍵字子集、或 bump schema 產新 run）。
 * 當**最新 linked run 非-ready（running/failed）但存在較舊 completed run**：data path/gate
 * （`queryAiSearchView→findLatestLinkedRun` 取最新 linked run 任何 status）用最新非-ready run → `POST /query{ai_*}`
 * 正確 **409 FEATURE_NOT_READY**；但若 `resolveViewDataVersion` 的 AI-search 分支自加 `status∈{completed,partial}`
 * filter（M15-R11 as-shipped）→ dataVersion 解出**舊 completed run.id** → cache key 不變 → `POST /ai-insight` 於
 * `AiInsightService.generate` 的 cache short-circuit（早於 `snapshotQuery.query()`/gate）**HIT 回舊 insight（200）**
 * ——跨端點不一致、繞過 feature gate、違 AC-32.2「不回舊 insight」+ AC-44.2 gating。
 *
 * 修正：dataVersion 改用**與 gate 同一** `findLatestLinkedRun`（最新 linked run 任何 status、owner-scoped）→
 * 最新非-ready run 時 dataVersion＝該非-ready run.id（cache 未曾為其落 insight → miss → 走 query → 409，與
 * `/query` 一致）；ready 時＝該 ready run（cache 正常）。M15-R11 owner-scope 續存。
 */

const OWNER_A = randomUUID();
const SESSION_A: AuthenticatedUser = { kind: 'session', id: OWNER_A, email: 'a@example.com' };

const LIMIT_ENV_KEYS = ['QUERY_MAX_PAGE_SIZE', 'AGG_MAX_BUCKETS', 'AGG_MAX_GROUPS'] as const;

const CONFIG: AiInsightConfig = {
  schemaVersion: 'v1',
  deployment: 'gpt-4o-mini',
  cacheTtlMs: 5184000000,
  maxRows: 200,
  queryMaxPageSize: 200,
};

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

/** Fake labeler：不打 Azure；回聲聚合列 `query`，令 insight 明確反映哪個 run 的資料被摘要（stale 可斷言）。 */
function makeLabeler(): { labeler: IntentLabeler; calls: () => number } {
  let count = 0;
  const parseChat = <T>(params: ParseChatParams): Promise<ParseChatResult<T>> => {
    count += 1;
    const content = params.messages.find((m) => m.role === 'user')?.content ?? '';
    const match = content.match(/Aggregated result \(JSON\): (\{[\s\S]*\})$/);
    const queries: string[] = [];
    if (match) {
      const agg = JSON.parse(match[1]) as { rows?: Array<{ query?: string }> };
      for (const r of agg.rows ?? []) {
        if (typeof r.query === 'string') queries.push(r.query);
      }
    }
    return Promise.resolve({
      parsed: { insight: `queries=[${queries.sort().join(',')}]` } as unknown as T,
      refusal: null,
    });
  };
  return { labeler: { parseChat }, calls: () => count };
}

describe('AI-insight dataVersion / gate consistency (integration · Testcontainers, TC-80 / AC-32.2 / AC-44.2 / M15-R13)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let snapshotQuery: SnapshotQueryService;
  let cache: CacheService;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of LIMIT_ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    process.env.QUERY_MAX_PAGE_SIZE = '200';
    process.env.AGG_MAX_BUCKETS = '200';
    process.env.AGG_MAX_GROUPS = '1000';
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queryConfig, cacheConfig] }),
        CacheModule,
        KeywordsModule,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    snapshotQuery = moduleRef.get(SnapshotQueryService);
    cache = moduleRef.get(CacheService);
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
    await cache.clear();
    await prisma.$executeRawUnsafe('DELETE FROM ai_answers');
    await prisma.$executeRawUnsafe('DELETE FROM ai_search_runs');
    await prisma.snapshotRow.deleteMany();
    await prisma.keywordAnalysis.updateMany({ data: { resultSnapshotId: null } });
    await prisma.resultSnapshot.deleteMany();
    await prisma.keywordAnalysis.deleteMany();
  });

  /** 建 owner-owned completed analysis + 不可變 snapshot，回 analysisId。 */
  async function seedAnalysis(ownerId: string | null): Promise<string> {
    const analysisId = randomUUID();
    const snapshotId = randomUUID();
    await prisma.keywordAnalysis.create({
      data: {
        id: analysisId,
        ownerId,
        status: 'running',
        seeds: [],
        params: {},
        progress: {},
        idempotencyKey: `idem-${analysisId}`,
      },
    });
    await prisma.resultSnapshot.create({
      data: { id: snapshotId, analysisId, keywordCount: 1, checksum: 'x' },
    });
    await prisma.snapshotRow.create({
      data: {
        snapshotId,
        analysisId,
        rowIndex: 0,
        data: srow() as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.keywordAnalysis.update({
      where: { id: analysisId },
      data: { status: 'completed', resultSnapshotId: snapshotId },
    });
    return analysisId;
  }

  /** 建 linked AiSearchRun（給定 status/createdAt）+（若 completed）一列 ai_answers（query 作 run 標記）；回 runId。 */
  async function seedRun(
    analysisId: string,
    ownerId: string | null,
    status: string,
    query: string | null,
    createdAt: Date,
  ): Promise<string> {
    const runId = randomUUID();
    await prisma.aiSearchRun.create({
      data: {
        id: runId,
        ownerId,
        keywordAnalysisId: analysisId,
        status,
        params: {},
        progress: {},
        idempotencyKey: `run-idem-${runId}`,
        createdAt,
      },
    });
    if (query !== null) {
      await prisma.aiAnswer.create({
        data: {
          ownerId,
          jobId: runId,
          schemaVersion: 'v1',
          channel: 'chatGpt',
          query,
          answerText: `answer for ${query}`,
          brands: [],
          positive: 0,
          negative: 0,
        },
      });
    }
    return runId;
  }

  it('a newer non-ready (running) run shadows an older completed run → /ai-insight must NOT return stale insight (consistent with /query 409)', async () => {
    const analysisId = await seedAnalysis(OWNER_A);
    // 先 completed run A（有 ai_answers）→ generate + cache insight。
    await seedRun(
      analysisId,
      OWNER_A,
      'completed',
      'alpha-query',
      new Date('2026-01-01T00:00:00Z'),
    );

    const { labeler } = makeLabeler();
    const service = new AiInsightService(labeler, snapshotQuery, cache, CONFIG);
    const req = { view: 'ai_answers', filters: {} };

    const insightA = await service.generate(analysisId, req, SESSION_A);
    expect(insightA.insight).toBe('queries=[alpha-query]');

    // 之後 link 一個 running run B（in-flight、無 ai_answers）→ 最新 linked run = B（非-ready）。
    await seedRun(analysisId, OWNER_A, 'running', null, new Date('2026-01-02T00:00:00Z'));

    // data path/gate 用最新非-ready run → /query 正確 409（consistency baseline）。
    await expect(snapshotQuery.query(analysisId, req, SESSION_A)).rejects.toBeInstanceOf(
      FeatureNotReadyException,
    );

    // /ai-insight 必與 /query 一致：不得從 cache short-circuit 回舊 insight A（dataVersion 須綁最新非-ready run）。
    await expect(service.generate(analysisId, req, SESSION_A)).rejects.toBeInstanceOf(
      FeatureNotReadyException,
    );
  });

  it('a newer non-ready (failed) run shadows an older completed run → /ai-insight 409 (not stale)', async () => {
    const analysisId = await seedAnalysis(OWNER_A);
    await seedRun(
      analysisId,
      OWNER_A,
      'completed',
      'alpha-query',
      new Date('2026-01-01T00:00:00Z'),
    );

    const { labeler } = makeLabeler();
    const service = new AiInsightService(labeler, snapshotQuery, cache, CONFIG);
    const req = { view: 'ai_answers', filters: {} };

    await service.generate(analysisId, req, SESSION_A); // cache insight for run A
    await seedRun(analysisId, OWNER_A, 'failed', null, new Date('2026-01-02T00:00:00Z'));

    await expect(service.generate(analysisId, req, SESSION_A)).rejects.toBeInstanceOf(
      FeatureNotReadyException,
    );
  });

  it('a newer READY (completed) run supersedes an older completed run → /ai-insight reflects the newer run (fresh, not stale)', async () => {
    const analysisId = await seedAnalysis(OWNER_A);
    await seedRun(
      analysisId,
      OWNER_A,
      'completed',
      'alpha-query',
      new Date('2026-01-01T00:00:00Z'),
    );

    const { labeler, calls } = makeLabeler();
    const service = new AiInsightService(labeler, snapshotQuery, cache, CONFIG);
    const req = { view: 'ai_answers', filters: {} };

    const first = await service.generate(analysisId, req, SESSION_A);
    expect(first.insight).toBe('queries=[alpha-query]');

    // 較新的 completed run B（bump/新關鍵字子集）→ dataVersion 換 → cache miss → 摘要 B 的資料。
    await seedRun(
      analysisId,
      OWNER_A,
      'completed',
      'bravo-query',
      new Date('2026-01-02T00:00:00Z'),
    );

    const second = await service.generate(analysisId, req, SESSION_A);
    expect(second.insight).toBe('queries=[bravo-query]');
    expect(second.insight).not.toContain('alpha-query');
    expect(calls()).toBe(2); // 版本翻轉 → 各自打 LLM（無舊 cache HIT）。
  });
});
