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
});
