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
 * TC-80 / AC-32.2 / S25.1（M15-R11 · Testcontainers 真 Postgres）—— **跨租戶 AI-insight cache 洩漏**：
 * `AiSearchRun` 有 `owner_id`，**shared（null-owner）analysis** 上兩 session 使用者各 link 自己的 run。
 * data path（`queryAiSearchView→findLatestLinkedRun(ownerWhere(actor))`）是 owner-scoped，但若 AI-insight cache
 * 的 `dataVersion`（`resolveViewDataVersion` AI-search 分支）取**全域最新** run.id（無 owner filter）→ 人人同
 * token → cache key（無 ownerId 成分）相同 → userB `generate()` 於 owner-scoped data path **之前** short-circuit
 * 命中 userA 的 owner-scoped insight（跨租戶洩漏，繞過 S8/NFR-15 owner-filter 單點）。
 *
 * 修正：dataVersion 解析必 owner-scoped（`...ownerWhere(actor)`）→ per-owner run.id → cache key 天然按 owner
 * 分家；apiKey（`ownerWhere={}`）→ 全域最新（AC-27.5，機器 actor 不隔離、共享 cache 正確）。
 */

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const SESSION_A: AuthenticatedUser = { kind: 'session', id: OWNER_A, email: 'a@example.com' };
const SESSION_B: AuthenticatedUser = { kind: 'session', id: OWNER_B, email: 'b@example.com' };
const API_KEY: AuthenticatedUser = { kind: 'apiKey' };

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

/**
 * Fake labeler：不打 Azure；回聲聚合中各列的 `query`（source-of-truth 標記），令 insight 明確反映**哪個
 * owner 的 owner-scoped 資料**被摘要——藉此把「userB 得到 userA 的 owner-scoped insight」的洩漏做成可斷言。
 * 亦記錄呼叫次數：cache-hit 洩漏時 userB 不打 LLM（count 停在 1）；owner 分家時各自打（count=2）。
 */
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

describe('AI-insight dataVersion owner-scope (integration · Testcontainers, TC-80 / AC-32.2 / M15-R11)', () => {
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

  /** 建 shared（null-owner）completed analysis + 不可變 snapshot，回 analysisId。 */
  async function seedSharedAnalysis(): Promise<string> {
    const analysisId = randomUUID();
    const snapshotId = randomUUID();
    await prisma.keywordAnalysis.create({
      data: {
        id: analysisId,
        ownerId: null, // 共享：session A 與 session B 皆可存取（AC-27.3）
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

  /** 建某 owner 的 completed linked AiSearchRun + 一列 ai_answers（query 作 owner 標記），回 runId=jobId。 */
  async function seedOwnerRun(
    analysisId: string,
    ownerId: string | null,
    query: string,
    createdAt: Date,
  ): Promise<string> {
    const runId = randomUUID();
    await prisma.aiSearchRun.create({
      data: {
        id: runId,
        ownerId,
        keywordAnalysisId: analysisId,
        status: 'completed',
        params: {},
        progress: {},
        idempotencyKey: `run-idem-${runId}`,
        createdAt,
      },
    });
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
    return runId;
  }

  it('does NOT leak owner A insight to owner B on a shared analysis (owner-scoped dataVersion)', async () => {
    const analysisId = await seedSharedAnalysis();
    // A 建立在前、B 在後 → 全域最新＝B 的 run（凸顯「無 owner filter 取全域最新」的洩漏）。
    await seedOwnerRun(analysisId, OWNER_A, 'alpha-query', new Date('2026-01-01T00:00:00Z'));
    await seedOwnerRun(analysisId, OWNER_B, 'bravo-query', new Date('2026-01-02T00:00:00Z'));

    const { labeler, calls } = makeLabeler();
    const service = new AiInsightService(labeler, snapshotQuery, cache, CONFIG);

    const req = { view: 'ai_answers', filters: {} };
    const insightA = await service.generate(analysisId, req, SESSION_A);
    const insightB = await service.generate(analysisId, req, SESSION_B);

    // A 摘要其**自己的** owner-scoped run 資料（alpha-query）。
    expect(insightA.insight).toBe('queries=[alpha-query]');
    // 洩漏若存在：B 於 owner-scoped data path 之前 short-circuit 命中 A 的 cache entry → 得 alpha-query。
    // 正確：B 得自己的 bravo-query（dataVersion owner-scoped → cache key 分家 → 各自打 LLM）。
    expect(insightB.insight).toBe('queries=[bravo-query]');
    expect(insightB.insight).not.toContain('alpha-query');
    expect(calls()).toBe(2); // 兩 owner 各自打一次 LLM（無跨租戶 cache hit）。
  });

  it('apiKey (machine actor) shares AI-insight cache globally — no owner isolation (AC-27.5)', async () => {
    const analysisId = await seedSharedAnalysis();
    await seedOwnerRun(analysisId, OWNER_A, 'alpha-query', new Date('2026-01-01T00:00:00Z'));

    const { labeler, calls } = makeLabeler();
    const service = new AiInsightService(labeler, snapshotQuery, cache, CONFIG);

    const req = { view: 'ai_answers', filters: {} };
    const first = await service.generate(analysisId, req, API_KEY);
    const second = await service.generate(analysisId, req, API_KEY);

    expect(first.insight).toBe('queries=[alpha-query]');
    expect(second.insight).toBe('queries=[alpha-query]');
    expect(calls()).toBe(1); // 第二次全域 cache hit（apiKey 不隔離、共享）。
  });
});
