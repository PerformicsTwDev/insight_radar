import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { CacheModule } from 'src/cache/cache.module';
import { CacheService } from 'src/cache/cache.service';
import { cacheConfig } from 'src/config/cache.config';
import { googleAdsConfig } from 'src/config/google-ads.config';
import { queueConfig } from 'src/config/queue.config';
import { ADS_CLIENT } from 'src/google-ads/ads-client.port';
import type {
  AdsClient,
  GenerateKeywordHistoricalMetricsRequest,
  KeywordHistoricalResult,
} from 'src/google-ads/ads-client.port';
import { GoogleAdsService } from 'src/google-ads/google-ads.service';
import { MetricsCache } from 'src/google-ads/metrics-cache';
import { IntentCache } from 'src/intent/intent-cache';
import { AZURE_OPENAI_DEPLOYMENT, INTENT_LABELER } from 'src/intent/intent-labeler.port';
import type {
  IntentLabeler,
  ParseChatParams,
  ParseChatResult,
} from 'src/intent/intent-labeler.port';
import { IntentService } from 'src/intent/intent.service';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import type { AnalysisJobPayload } from 'src/keyword-analysis/keyword-analysis.service';
import { ResultSnapshotService } from 'src/keyword-analysis/result-snapshot.service';
import { PrismaModule, PrismaService } from 'src/prisma';

/** 從 user message（JSON 陣列）取回關鍵字。 */
function extractKeywords(params: ParseChatParams): string[] {
  const userMsg = params.messages.find((m) => m.role === 'user');
  const match = userMsg?.content.match(/\[[\s\S]*\]/);
  return match ? (JSON.parse(match[0]) as string[]) : [];
}

const PARAMS = {
  geo: 'geoTargetConstants/2158',
  language: 'languageConstants/1018',
  mode: 'exact' as const,
  includeAdult: false,
};

const EXPAND_PARAMS = { ...PARAMS, mode: 'expand' as const };

function fakeJob(
  analysisId: string,
  seeds: string[],
  params: typeof PARAMS | typeof EXPAND_PARAMS = PARAMS,
): { id: string; data: AnalysisJobPayload; updateProgress: () => Promise<void> } {
  return {
    id: analysisId,
    data: { analysisId, seeds, params },
    updateProgress: () => Promise.resolve(), // BullMQ/Redis（本測試不驗即時串流，no-op）
  };
}

describe('cache-first integration (T4.4 / TC-20 / FR-10 / AC-10.5 · Testcontainers)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let processor: KeywordAnalysisProcessor;
  let cacheService: CacheService;
  const adsCalls = { historical: 0 };
  const labelerCalls = { parse: 0 };

  // 真實指標（非 null）：warm==cold checksum 斷言才有意義（會真正重建 micros→CPC / volumes），
  // 且無指標列不回寫（M4-R1）——若回 null 指標，cache 將不寫入、warm 仍會重打 Ads。
  const realMetrics = {
    avg_monthly_searches: 480,
    competition: 'LOW',
    competition_index: 25,
    low_top_of_page_bid_micros: '500000',
    high_top_of_page_bid_micros: '1500000',
    monthly_search_volumes: [{ year: 2026, month: 'JANUARY', monthly_searches: 480 }],
  };

  const fakeAds: AdsClient = {
    // expand 模式：每個 seed 回一個帶指標的拓展字（`${seed} expanded`）——讓 expand→msetByText→exact-hit
    // round-trip 可經真實 stack 驗證（M4-R5）。seed 自身不在此回（仍為 noMetrics 攤平）。
    generateKeywordIdeas: (req) =>
      Promise.resolve(
        req.keyword_seed.keywords.map((s) => ({
          text: `${s} expanded`,
          keyword_idea_metrics: realMetrics,
          close_variants: [],
        })),
      ),
    generateKeywordHistoricalMetrics: (
      req: GenerateKeywordHistoricalMetricsRequest,
    ): Promise<KeywordHistoricalResult[]> => {
      adsCalls.historical += 1;
      return Promise.resolve(
        req.keywords.map((kw) => ({ text: kw, keyword_metrics: realMetrics, close_variants: [] })),
      );
    },
  };

  const fakeLabeler: IntentLabeler = {
    parseChat: <T>(params: ParseChatParams): Promise<ParseChatResult<T>> => {
      labelerCalls.parse += 1;
      const kws = extractKeywords(params);
      return Promise.resolve({
        parsed: { results: kws.map((k) => ({ keyword: k, labels: ['informational'] })) } as T,
        refusal: null,
      });
    },
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, CacheModule],
      providers: [
        KeywordAnalysisProcessor,
        GoogleAdsService,
        IntentService,
        ResultSnapshotService,
        MetricsCache,
        IntentCache,
        { provide: ADS_CLIENT, useValue: fakeAds },
        { provide: INTENT_LABELER, useValue: fakeLabeler },
        { provide: AZURE_OPENAI_DEPLOYMENT, useValue: 'test-deploy' },
        { provide: 'INTENT_SERVICE_CONFIG', useValue: { batchSize: 30 } },
        {
          provide: googleAdsConfig.KEY,
          useValue: { historicalBatchSize: 1000, customerId: 'cid' },
        },
        {
          provide: cacheConfig.KEY,
          useValue: { metricsTtlMs: 1_000_000, intentTtlMs: 1_000_000, intentSchemaVersion: 'v1' },
        },
        {
          provide: queueConfig.KEY,
          useValue: {
            workerConcurrency: 1,
            jobAttempts: 5,
            jobBackoffMs: 1,
            idempTtlMs: 1,
            jobTtlMs: 1,
          },
        },
      ],
    }).compile();

    // 直接用編譯後的 module（不 app.init()）：避免觸發 processor 的 onApplicationBootstrap（本測試無
    // BullModule/worker）；直接呼叫 process()。PrismaService 為 lazy-connect（首查才連線）。
    prisma = moduleRef.get(PrismaService);
    processor = moduleRef.get(KeywordAnalysisProcessor);
    cacheService = moduleRef.get(CacheService);
  });

  afterAll(async () => {
    await moduleRef.close(); // onModuleDestroy → Prisma $disconnect + Cache disconnect（防 Jest hang）
  });

  afterEach(async () => {
    await prisma.snapshotRow.deleteMany();
    await prisma.keywordAnalysis.updateMany({ data: { resultSnapshotId: null } });
    await prisma.resultSnapshot.deleteMany();
    await prisma.keywordAnalysis.deleteMany();
    await prisma.keyword.deleteMany(); // canonical metrics（T4.6）
    await prisma.keywordIntent.deleteMany(); // canonical intents（T4.6）
    await cacheService.clear(); // 清 in-memory Keyv：測試隔離，避免跨測試殘留導致假命中（M4-R5）
  });

  async function seedRunning(id: string): Promise<void> {
    await prisma.keywordAnalysis.create({
      data: {
        id,
        status: 'running',
        seeds: ['x'],
        params: { mode: 'exact' },
        progress: { phase: 'running', percent: 50 },
        idempotencyKey: `idem-${id}`,
      },
    });
  }

  async function completedSnapshot(
    id: string,
  ): Promise<{ checksum: string; keywordCount: number }> {
    const row = await prisma.keywordAnalysis.findUnique({
      where: { id },
      include: { resultSnapshot: true },
    });
    const snap = row?.resultSnapshot;
    if (!snap) {
      throw new Error(`no snapshot for ${id}`);
    }
    return { checksum: snap.checksum, keywordCount: snap.keywordCount };
  }

  it('a cached job makes no Ads/LLM calls and matches the uncached result (TC-20, AC-10.5)', async () => {
    const seeds = ['running shoes', 'trail shoes'];
    const coldId = randomUUID();
    const warmId = randomUUID();

    // 冷跑（空快取）→ 打 Ads + LLM、回寫快取。
    await seedRunning(coldId);
    await processor.process(fakeJob(coldId, seeds) as never);
    const cold = await completedSnapshot(coldId);
    expect(adsCalls.historical).toBeGreaterThan(0);
    expect(labelerCalls.parse).toBeGreaterThan(0);

    // 暖跑（同 seeds，冷跑已回寫）→ **不再打** Ads / LLM。
    const adsBefore = adsCalls.historical;
    const labelerBefore = labelerCalls.parse;
    await seedRunning(warmId);
    await processor.process(fakeJob(warmId, seeds) as never);
    const warm = await completedSnapshot(warmId);

    expect(adsCalls.historical).toBe(adsBefore); // 命中 metrics 快取 → 不打 Ads
    expect(labelerCalls.parse).toBe(labelerBefore); // 命中 intent 快取 → 不打 LLM
    // 命中與否最終結果一致（去重 key = 快取 key = normalizedText）。
    expect(warm.checksum).toBe(cold.checksum);
    expect(warm.keywordCount).toBe(cold.keywordCount);
  });

  it('after the Redis cache is cleared, a repeat job is served from the DB canonical without re-hitting Ads/LLM (T4.6, M4-R5)', async () => {
    const seeds = ['db fallback kw'];

    // 冷跑：打 Ads + LLM → 回寫 Redis **與** DB canonical（兩層皆有）。
    const coldId = randomUUID();
    await seedRunning(coldId);
    await processor.process(fakeJob(coldId, seeds) as never);
    expect(adsCalls.historical).toBeGreaterThan(0);

    // 清掉 Redis（模擬 eviction / 失效）——DB canonical 仍在。此處須真清快取，否則暖跑會走 Redis、驗不到 DB 後備。
    await cacheService.clear();

    const adsBefore = adsCalls.historical;
    const labelerBefore = labelerCalls.parse;
    const warmId = randomUUID();
    await seedRunning(warmId);
    await processor.process(fakeJob(warmId, seeds) as never);

    // Redis 已清 → metrics + intent 由 DB canonical 回填 → 不打 Ads/LLM（Redis 失效不致重打全部外部 API）。
    expect(adsCalls.historical).toBe(adsBefore);
    expect(labelerCalls.parse).toBe(labelerBefore);
    const snap = await completedSnapshot(warmId);
    expect(snap.keywordCount).toBeGreaterThan(0);
  });

  it('an expand run writes expansion metrics to canonical; a later exact query hits without re-paying Ads/LLM (T4.4 round-trip, M4-R5)', async () => {
    const seed = 'roundtrip seed';
    const expansion = `${seed} expanded`;

    // expand：generateKeywordIdeas 回帶指標的拓展字 → mergeExpansion → msetByText 回寫 Redis + DB canonical。
    const expandId = randomUUID();
    await seedRunning(expandId);
    await processor.process(fakeJob(expandId, [seed], EXPAND_PARAMS) as never);
    const row = await prisma.keyword.findFirst({ where: { normalizedText: expansion } });
    expect(row?.avgMonthlySearches).toBe(480); // 拓展字已持久化（有指標）

    // 之後對「拓展字」做 exact 查詢 → 命中（Redis 暖 + DB 後備）→ 不再打 Ads/LLM。
    const adsBefore = adsCalls.historical;
    const labelerBefore = labelerCalls.parse;
    const exactId = randomUUID();
    await seedRunning(exactId);
    await processor.process(fakeJob(exactId, [expansion]) as never);
    expect(adsCalls.historical).toBe(adsBefore); // 命中 metrics 快取 → 不重打 Ads
    expect(labelerCalls.parse).toBe(labelerBefore); // 命中 intent 快取 → 不重打 LLM
  });

  it('an expand run with a no-metrics seed does not clobber canonical metrics from a prior exact run (M4-R1)', async () => {
    const seed = 'alpha clobber kw';

    // Run 1（exact）：Ads 回真實指標 → 回寫 DB canonical（有指標）。
    const exactId = randomUUID();
    await seedRunning(exactId);
    await processor.process(fakeJob(exactId, [seed]) as never);
    const before = await prisma.keyword.findFirst({ where: { normalizedText: seed } });
    expect(before?.avgMonthlySearches).toBe(480); // canonical 有真實指標

    // Run 2（expand）：seed 自身不在 generateKeywordIdeas 回應中 → 以 noMetrics() 攤平 → msetByText 須跳過（不覆蓋）。
    const expandId = randomUUID();
    await seedRunning(expandId);
    await processor.process(fakeJob(expandId, [seed], EXPAND_PARAMS) as never);

    const after = await prisma.keyword.findFirst({ where: { normalizedText: seed } });
    expect(after?.avgMonthlySearches).toBe(480); // 仍為真實指標，未被 null 覆蓋（無污染）
  });
});
