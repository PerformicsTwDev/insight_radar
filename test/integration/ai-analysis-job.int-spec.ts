import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { AiSearchCanonical } from 'src/captures/mapping/canonical.types';
import type { CaptureChannel } from 'src/captures/dto/capture-ingest.dto';
import type {
  IntentLabeler,
  ParseChatParams,
  ParseChatResult,
} from 'src/intent/intent-labeler.port';
import type { PrismaService } from 'src/prisma';
import { AiAnalysisRepository } from 'src/ai-visibility/ai-analysis.repository';
import { AiAnalysisService } from 'src/ai-visibility/ai-analysis.service';
import { BrandExtractionService } from 'src/ai-visibility/brand-extraction.service';
import { SentimentService } from 'src/ai-visibility/sentiment.service';
import { MediaClassifierService } from 'src/ai-visibility/media-classifier.service';
import { normalizeText } from 'src/google-ads/normalize';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * TC-78 部分 (T15.5 · FR-42/AC-42.5 · Testcontainers): AI 分析 job 編排 + 持久化 + partial 降級。
 * `AiSearchCapture` → 品牌抽取/情緒/媒體（真 service + fake Azure labeler）→ `buildAiVisibility` →
 * **指標落庫**（ai_answers / ai_cited_references / ai_visibility_metrics）；**某 query LLM 失敗 → partial
 * 保留、不污染他筆**（needsReview 收斂 job-level）。Azure OpenAI 全 mock（fake labeler）；DB＝真 Postgres。
 */

/** 標記：blocks/refs 文字含此標記 → fake labeler 對該批 refusal（模擬某 query LLM 失敗）。 */
const FAIL = '__FAIL__';

/** 從隔離後的 user 訊息還原 LLM 實際收到的一批 item（[{id,text}] 或 [{id,link}]）。 */
function itemsOf(params: ParseChatParams): Array<{ id: string; text?: string; link?: string }> {
  const userMsg = params.messages.find((m) => m.role === 'user');
  const match = userMsg?.content.match(/\[[\s\S]*\]/);
  return match ? (JSON.parse(match[0]) as Array<{ id: string; text?: string; link?: string }>) : [];
}

/** 該批是否命中失敗標記（模擬 content_filter/refusal，某 query 的 block/ref 失敗）。 */
function batchFails(items: Array<{ text?: string; link?: string }>): boolean {
  return items.some((i) => (i.text ?? i.link ?? '').includes(FAIL));
}

/**
 * fake Azure labeler：依 jsonSchema.name 分派三線；命中 FAIL 標記的批 → refusal（parsed=null）。
 * brand：text 含 'ASUS'→['ASUS']、含 '華碩'→['華碩','華碩']（測正規化 + 不去重）。sentiment：正面 {1,0}。
 * media：每 ref → 'retail'（asus.com）。batchSize=1（各 block/ref 獨立批）→ 失敗僅落單筆、不污染他筆。
 */
function fakeLabeler(): IntentLabeler {
  const parseChat = <T>(params: ParseChatParams): Promise<ParseChatResult<T>> => {
    const items = itemsOf(params);
    if (batchFails(items)) {
      return Promise.resolve({ parsed: null, refusal: 'content_filter' } as ParseChatResult<T>);
    }
    const name = params.jsonSchema.name;
    if (name === 'brand_extraction') {
      return Promise.resolve({
        parsed: {
          results: items.map((i) => {
            const brands: string[] = [];
            if ((i.text ?? '').includes('ASUS')) brands.push('ASUS');
            if ((i.text ?? '').includes('華碩')) brands.push('華碩', '華碩');
            return { id: i.id, brands };
          }),
        },
        refusal: null,
      } as unknown as ParseChatResult<T>);
    }
    if (name === 'brand_sentiment') {
      return Promise.resolve({
        parsed: { results: items.map((i) => ({ id: i.id, positive: 1, negative: 0 })) },
        refusal: null,
      } as unknown as ParseChatResult<T>);
    }
    // media_classification：回 `{ references: [...] }`（媒體線骨架約定的陣列鍵）。
    return Promise.resolve({
      parsed: { references: items.map((i) => ({ id: i.id, type: 'retail' })) },
      refusal: null,
    } as unknown as ParseChatResult<T>);
  };
  return { parseChat };
}

function canonical(channel: CaptureChannel, query: string, blockText: string): AiSearchCanonical {
  return {
    source: 'extension',
    channel,
    schemaVersion: 'v1',
    query,
    blocks: [blockText],
    references: blockText.includes(FAIL)
      ? []
      : [{ title: 'ASUS official', link: 'https://asus.com/zenbook', index: 0 }],
    capturedAt: new Date().toISOString(),
  };
}

describe('AiAnalysisService (integration · Testcontainers, TC-78 部分)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: AiAnalysisService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    const labeler = fakeLabeler();
    const brands = new BrandExtractionService(labeler, { batchSize: 1 });
    const sentiment = new SentimentService(labeler, { batchSize: 1 });
    const media = new MediaClassifierService(labeler, { batchSize: 1 });
    const repo = new AiAnalysisRepository(prisma);
    service = new AiAnalysisService(brands, sentiment, media, repo, prisma, {
      schemaVersion: 'v1',
    });
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM ai_visibility_metrics');
    await prisma.$executeRawUnsafe('DELETE FROM ai_cited_references');
    await prisma.$executeRawUnsafe('DELETE FROM ai_answers');
    await prisma.$executeRawUnsafe('DELETE FROM brand_profiles');
    await prisma.$executeRawUnsafe('DELETE FROM ai_search_runs');
    await prisma.$executeRawUnsafe('DELETE FROM keyword_journey_assignments');
    await prisma.$executeRawUnsafe('DELETE FROM keyword_intents');
    await prisma.snapshotRow.deleteMany();
    await prisma.keywordAnalysis.updateMany({ data: { resultSnapshotId: null } });
    await prisma.resultSnapshot.deleteMany();
    await prisma.keywordAnalysis.deleteMany();
  });

  async function seedBrand(): Promise<string> {
    const row = await prisma.brandProfile.create({
      data: {
        ownerId: null,
        name: 'ASUS',
        aliases: ['華碩'],
        sites: ['asus.com'],
        competitors: [{ name: 'Acer', aliases: [], sites: ['acer.com'] }],
      },
    });
    return row.id;
  }

  it('captures → 品牌/情緒/媒體 → 指標落庫（mentions 不去重、citations 命中、per-brand 列）', async () => {
    const brandProfileId = await seedBrand();
    const jobId = randomUUID();

    const result = await service.analyzeAndPersist({
      jobId,
      ownerId: null,
      brandProfileId,
      captures: [canonical('chatGpt', 'asus zenbook', 'ASUS is great, 華碩 rocks')],
    });

    expect(result.needsReview).toBe(0);
    expect(result.answersCount).toBe(1);

    // ai_answers：本品牌提及（華碩→ASUS 正規化 + 不去重＝露出次數 S17）+ 情緒褒。
    const answers = await prisma.aiAnswer.findMany({ where: { jobId } });
    expect(answers).toHaveLength(1);
    expect(answers[0].brands).toEqual(['ASUS', 'ASUS', 'ASUS']); // ASUS×1 + 華碩→ASUS×2（不去重）
    expect(answers[0].positive).toBe(1);

    // ai_cited_references：媒體分類 enum 落庫。
    const cited = await prisma.aiCitedReference.findMany({ where: { jobId } });
    expect(cited).toHaveLength(1);
    expect(cited[0].mediaType).toBe('retail');
    expect(cited[0].domain).toBe('asus.com');

    // ai_visibility_metrics：per (channel × keyword × brand) 指標。ASUS mentions=3、citations=1（asus.com 命中）。
    const metrics = await prisma.aiVisibilityMetric.findMany({ where: { jobId, brand: 'ASUS' } });
    expect(metrics).toHaveLength(1);
    expect(metrics[0].mentions).toBe(3);
    expect(metrics[0].citations).toBe(1);
    expect(metrics[0].dimension).toBe('keyword');
    // 競品 Acer 恆產出一列（零提及）——share of voice 分母>0、分子 0 → 真實 0（不遮蔽）。
    const acer = await prisma.aiVisibilityMetric.findMany({ where: { jobId, brand: 'Acer' } });
    expect(acer).toHaveLength(1);
    expect(acer[0].mentions).toBe(0);
    expect(acer[0].shareOfVoice).toBe(0);
  });

  it('某 query LLM 失敗 → partial 保留、不污染他筆（needsReview 收斂 job-level）', async () => {
    const brandProfileId = await seedBrand();
    const jobId = randomUUID();

    const result = await service.analyzeAndPersist({
      jobId,
      ownerId: null,
      brandProfileId,
      captures: [
        canonical('chatGpt', 'good kw', 'ASUS is great'),
        canonical('chatGpt', 'bad kw', `${FAIL} unanalyzable`),
      ],
    });

    // 某線降級 → job-level needsReview > 0（processor 據此標 run partial，AC-42.5/INV-6）。
    expect(result.needsReview).toBeGreaterThan(0);

    const answers = await prisma.aiAnswer.findMany({ where: { jobId }, orderBy: { query: 'asc' } });
    expect(answers).toHaveLength(2);
    const bad = answers.find((a) => a.query === 'bad kw');
    const good = answers.find((a) => a.query === 'good kw');
    // 失敗筆：補預設（空品牌、情緒 0）——標記缺值。
    expect(bad?.brands).toEqual([]);
    expect(bad?.positive).toBe(0);
    expect(bad?.negative).toBe(0);
    // 他筆不受污染：good 正常抽出 ASUS + 情緒褒。
    expect(good?.brands).toEqual(['ASUS']);
    expect(good?.positive).toBe(1);

    // 指標仍落庫（partial 不整批失敗）：good query 的 ASUS 指標存在。
    const goodMetric = await prisma.aiVisibilityMetric.findMany({
      where: { jobId, brand: 'ASUS', groupKey: 'good kw' },
    });
    expect(goodMetric).toHaveLength(1);
    expect(goodMetric[0].mentions).toBe(1);
  });

  // M15-R8/#689：原子 replaceForJob（delete + 三 createMany 單一 $transaction）——persist 期基礎設施錯 → 整批
  // rollback，delete 與 creates 全有或全無，不再「刪了卻沒寫」的跨表撕裂 / 資料流失（INV-6 idempotent re-run）。
  it('R8：persist 期失敗 → 整批 rollback、無跨表撕裂（前次列完好）', async () => {
    const repo = new AiAnalysisRepository(prisma);
    const jobId = randomUUID();
    const rows = {
      answers: [
        {
          channel: 'chatGpt',
          query: 'q',
          answerText: 'a',
          brands: ['ASUS'],
          positive: 1,
          negative: 0,
        },
      ],
      cited: [
        {
          channel: 'chatGpt',
          query: 'q',
          link: 'https://asus.com',
          domain: 'asus.com',
          title: null,
          mediaType: 'retail',
        },
      ],
      metrics: [
        {
          channel: 'chatGpt',
          dimension: 'keyword',
          groupKey: 'q',
          brand: 'ASUS',
          mentions: 1,
          shareOfVoice: 1,
          citations: 0,
          exposure: null,
        },
      ],
    };
    // 首次成功 replace → 三表各落 1 列（前次 run 的 durable 結果）。
    await repo.replaceForJob(jobId, null, 'v1', rows);
    // 二次以非法 ownerId（uuid cast 失敗，模擬 persist 期基礎設施錯）→ 整個 $transaction 應 rollback。
    await expect(repo.replaceForJob(jobId, 'not-a-uuid', 'v1', rows)).rejects.toBeDefined();
    // 前次列完好：delete 與 create 同一 txn 一起 rollback → 非「刪了卻沒寫」的撕裂（非原子時三表會被清空）。
    expect(await prisma.aiAnswer.count({ where: { jobId } })).toBe(1);
    expect(await prisma.aiCitedReference.count({ where: { jobId } })).toBe(1);
    expect(await prisma.aiVisibilityMetric.count({ where: { jobId } })).toBe(1);
  });

  // ── #678 G3 (T15.8b, AC-43.3)：assembleAnalysis 補 query→意圖(keyword_intents)/購買歷程
  // (keyword_journey_assignments) join → ai_visibility_metrics 含 intent/journey 維度 scope。 ──
  it('G3：linked analysis 有 intent/journey 指派 → 指標落 keyword + intent + journey 三維度', async () => {
    const brandProfileId = await seedBrand();
    const analysisId = randomUUID();
    const snapshotId = randomUUID();
    const jobId = randomUUID();
    const query = 'asus zenbook';
    const nt = normalizeText(query);

    await prisma.keywordAnalysis.create({
      data: {
        id: analysisId,
        status: 'completed',
        seeds: [],
        params: {},
        progress: {},
        idempotencyKey: `idem-${analysisId}`,
      },
    });
    await prisma.resultSnapshot.create({
      data: { id: snapshotId, analysisId, keywordCount: 1, checksum: 'x' },
    });
    await prisma.keywordAnalysis.update({
      where: { id: analysisId },
      data: { resultSnapshotId: snapshotId },
    });
    // AI Search run linked → analyzeAndPersist 由 jobId 解出 keywordAnalysisId → snapshot → journey 指派。
    await prisma.aiSearchRun.create({
      data: {
        id: jobId,
        ownerId: null,
        keywordAnalysisId: analysisId,
        status: 'running',
        params: {},
        progress: {},
        idempotencyKey: `run-${jobId}`,
      },
    });
    // M2 意圖（keyword_intents，全域 by normalizedText）+ FR-33 購買歷程（keyword_journey_assignments，by snapshot）。
    await prisma.keywordIntent.create({
      data: { normalizedText: nt, modelVersion: 'v-test', labels: ['commercial'] },
    });
    await prisma.keywordJourneyAssignment.create({
      data: { analysisId, snapshotId, normalizedText: nt, stage: 'consideration' },
    });

    await service.analyzeAndPersist({
      jobId,
      ownerId: null,
      brandProfileId,
      captures: [canonical('chatGpt', query, 'ASUS is great')],
    });

    // keyword 維度（既有）。
    const keywordDim = await prisma.aiVisibilityMetric.findMany({
      where: { jobId, dimension: 'keyword', brand: 'ASUS' },
    });
    expect(keywordDim).toHaveLength(1);
    expect(keywordDim[0].groupKey).toBe(query);

    // intent 維度（G3）：group=意圖類別、mentions 沿用同一露出（不改情緒/意圖語意，僅加維度）。
    const intentDim = await prisma.aiVisibilityMetric.findMany({
      where: { jobId, dimension: 'intent', brand: 'ASUS' },
    });
    expect(intentDim).toHaveLength(1);
    expect(intentDim[0].groupKey).toBe('commercial');
    expect(intentDim[0].mentions).toBe(1);

    // journey 維度（G3）：group=購買歷程階段。
    const journeyDim = await prisma.aiVisibilityMetric.findMany({
      where: { jobId, dimension: 'journey', brand: 'ASUS' },
    });
    expect(journeyDim).toHaveLength(1);
    expect(journeyDim[0].groupKey).toBe('consideration');
  });

  it('G3：standalone job（無 linked analysis）→ 僅 keyword 維度（無 intent/journey，不硬崩）', async () => {
    const brandProfileId = await seedBrand();
    const jobId = randomUUID();
    // 無 aiSearchRun / 無 keyword_intents / 無 journey 指派 → intent/journey 映射空。
    await service.analyzeAndPersist({
      jobId,
      ownerId: null,
      brandProfileId,
      captures: [canonical('chatGpt', 'asus zenbook', 'ASUS is great')],
    });
    const dims = await prisma.aiVisibilityMetric.findMany({ where: { jobId } });
    expect(dims.every((d) => d.dimension === 'keyword')).toBe(true);
  });

  // ── #678 G4 (T15.8c, AC-43.1)：exposure 接 Search 線 avgMonthlySearches（linked analysis 不可變 snapshot 列，
  // by normalizedText）→ ai_visibility_metrics.exposure 加總；**null 不補 0、全 null→null、真實 0 保留**。 ──
  it('G4：linked snapshot 有 avgMonthlySearches → exposure 加總（null 不計入、真 0 保留、跨字去重 intent 加總）', async () => {
    const brandProfileId = await seedBrand();
    const analysisId = randomUUID();
    const snapshotId = randomUUID();
    const jobId = randomUUID();
    // 三字：有值(1300) / 缺量(null) / 真實 0。皆歸 intent 'commercial' → intent 範疇加總二有值（null 略過）。
    const seeded = [
      { query: 'asus zenbook', avgMonthlySearches: 1300 as number | null },
      { query: 'acer swift', avgMonthlySearches: null as number | null },
      { query: 'zero kw', avgMonthlySearches: 0 as number | null },
    ];

    await prisma.keywordAnalysis.create({
      data: {
        id: analysisId,
        status: 'completed',
        seeds: [],
        params: {},
        progress: {},
        idempotencyKey: `idem-${analysisId}`,
      },
    });
    await prisma.resultSnapshot.create({
      data: { id: snapshotId, analysisId, keywordCount: seeded.length, checksum: 'x' },
    });
    // Search 線落庫＝不可變 snapshot 列（SnapshotRowData：normalizedText + avgMonthlySearches）。
    await prisma.snapshotRow.createMany({
      data: seeded.map((s, rowIndex) => ({
        snapshotId,
        analysisId,
        rowIndex,
        data: {
          text: s.query,
          normalizedText: normalizeText(s.query),
          avgMonthlySearches: s.avgMonthlySearches,
          competition: 'LOW',
          competitionIndex: null,
          cpcLow: null,
          cpcHigh: null,
          intent: [],
          monthlyVolumes: [],
        },
      })),
    });
    await prisma.keywordAnalysis.update({
      where: { id: analysisId },
      data: { resultSnapshotId: snapshotId },
    });
    await prisma.aiSearchRun.create({
      data: {
        id: jobId,
        ownerId: null,
        keywordAnalysisId: analysisId,
        status: 'running',
        params: {},
        progress: {},
        idempotencyKey: `run-${jobId}`,
      },
    });
    for (const s of seeded) {
      await prisma.keywordIntent.create({
        data: {
          normalizedText: normalizeText(s.query),
          modelVersion: 'v-test',
          labels: ['commercial'],
        },
      });
    }

    await service.analyzeAndPersist({
      jobId,
      ownerId: null,
      brandProfileId,
      captures: seeded.map((s) => canonical('chatGpt', s.query, 'ASUS is great')),
    });

    const exposureOf = async (dimension: string, groupKey: string): Promise<number | null> => {
      const row = await prisma.aiVisibilityMetric.findFirst({
        where: { jobId, dimension, groupKey, brand: 'ASUS' },
      });
      return row?.exposure ?? null;
    };
    // keyword 維度：per-keyword exposure。
    expect(await exposureOf('keyword', 'asus zenbook')).toBe(1300); // 有值 → 落非 null
    expect(await exposureOf('keyword', 'acer swift')).toBeNull(); // 缺量 → null（不補 0）
    expect(await exposureOf('keyword', 'zero kw')).toBe(0); // 真實 0 保留（≠ null）
    // intent 維度：'commercial' 範疇跨三字去重加總＝1300 + 0（null 略過）＝1300。
    expect(await exposureOf('intent', 'commercial')).toBe(1300);
  });
});
