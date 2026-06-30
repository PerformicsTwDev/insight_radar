import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { CacheModule } from 'src/cache/cache.module';
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

function fakeJob(
  analysisId: string,
  seeds: string[],
): { id: string; data: AnalysisJobPayload; updateProgress: () => Promise<void> } {
  return {
    id: analysisId,
    data: { analysisId, seeds, params: PARAMS },
    updateProgress: () => Promise.resolve(), // BullMQ/Redis（本測試不驗即時串流，no-op）
  };
}

describe('cache-first integration (T4.4 / TC-20 / FR-10 / AC-10.5 · Testcontainers)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let processor: KeywordAnalysisProcessor;
  const adsCalls = { historical: 0 };
  const labelerCalls = { parse: 0 };

  const fakeAds: AdsClient = {
    generateKeywordIdeas: () => Promise.resolve([]),
    generateKeywordHistoricalMetrics: (
      req: GenerateKeywordHistoricalMetricsRequest,
    ): Promise<KeywordHistoricalResult[]> => {
      adsCalls.historical += 1;
      return Promise.resolve(
        req.keywords.map((kw) => ({ text: kw, keyword_metrics: null, close_variants: [] })),
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

  it('a Redis miss falls back to the DB canonical without re-hitting Ads/LLM (T4.6)', async () => {
    // 預填 DB canonical（Redis 空——用未被前面測試暖過的字）：模擬 Redis 失效後仍有持久後備。
    const nt = 'db backed kw';
    await prisma.keyword.create({
      data: {
        geo: PARAMS.geo,
        language: PARAMS.language,
        normalizedText: nt,
        text: nt,
        monthlyVolumes: [],
      },
    });
    await prisma.keywordIntent.create({
      data: { normalizedText: nt, modelVersion: 'v1:test-deploy', labels: ['informational'] },
    });

    const adsBefore = adsCalls.historical;
    const labelerBefore = labelerCalls.parse;
    const id = randomUUID();
    await seedRunning(id);
    await processor.process(fakeJob(id, [nt]) as never);

    // Redis 皆 miss → metrics + intent 由 DB canonical 回填 → 不打 Ads/LLM（Redis 失效不致重打全部外部 API）。
    expect(adsCalls.historical).toBe(adsBefore);
    expect(labelerCalls.parse).toBe(labelerBefore);
    const snap = await completedSnapshot(id);
    expect(snap.keywordCount).toBeGreaterThan(0);
  });
});
