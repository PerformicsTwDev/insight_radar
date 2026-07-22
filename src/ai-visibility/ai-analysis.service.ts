import { Inject, Injectable } from '@nestjs/common';
import type { BrandAliasInput } from '../brand-profile/brand-match';
import { toBrandProfileView } from '../brand-profile/brand-profile.mapper';
import type { CaptureChannel } from '../captures/dto/capture-ingest.dto';
import type { AiSearchCanonical } from '../captures/mapping/canonical.types';
import { ownerWhereFromOwnerId } from '../common/owner-scope';
import { normalizeText } from '../google-ads/normalize';
import { PrismaService } from '../prisma';
import { AiAnalysisRepository } from './ai-analysis.repository';
import type {
  AiAnalysisResult,
  AiAnalysisStore,
  AiAnswerRow,
  AiCitedReferenceRow,
  AiVisibilityMetricRow,
  BrandExtractor,
  CitedMediaClassifier,
  SentimentAnalyzer,
} from './ai-analysis.types';
import { BrandExtractionService } from './brand-extraction.service';
import { MediaClassifierService } from './media-classifier.service';
import { SentimentService } from './sentiment.service';
import {
  type AiVisibilityScope,
  type VisibilityBrand,
  buildAiVisibility,
  normalizeDomain,
} from './visibility-metrics';

/** DI token for AiAnalysisService 設定（analysis 層 schema 版本；由 module 從 AI_VISIBILITY_SCHEMA_VERSION 組裝）。 */
export const AI_ANALYSIS_CONFIG = Symbol('AI_ANALYSIS_CONFIG');

export interface AiAnalysisConfig {
  /** AI_VISIBILITY_SCHEMA_VERSION（分析/指標快取 namespace）——落庫每列標記，bump 即整批失效。 */
  schemaVersion: string;
}

/** `analyzeAndPersist` 輸入：某抓取 job（jobId=AiSearchRun.id）合流的 AiSearchCapture + 品牌檔案。 */
export interface AnalyzeAndPersistInput {
  jobId: string;
  ownerId: string | null;
  brandProfileId: string | null;
  captures: readonly AiSearchCanonical[];
}

/** 報告用品牌集（visibility metrics + 抽取正規化 + 情緒目標本品牌）。 */
interface LoadedBrands {
  visibilityBrands: VisibilityBrand[];
  aliases: BrandAliasInput[];
  primary: BrandAliasInput | null;
}

/** 每筆 capture 攤平後的分析語境（合成 block/reference id + 回連 channel/query，供結果對回聚合）。 */
interface CaptureContext {
  channel: CaptureChannel;
  query: string;
  blockIds: string[];
  texts: string[];
  refs: Array<{ id: string; link: string; title: string | null }>;
}

/** 三線 per-input LLM 結果依 id 索引（供組裝層對回聚合）。 */
interface AnalysisIndex {
  brandById: Map<string, string[]>;
  sentimentById: Map<string, { positive: number; negative: number }>;
  mediaById: Map<string, string>;
}

/**
 * AI 分析 job 編排（T15.5，FR-42/AC-42.5；Design §18.4）。把 AI Search 抓取 job 合流的 `AiSearchCapture` →
 * 三線 LLM pipeline（品牌抽取/情緒/媒體，T15.2/T15.3）→ 組裝 `AiVisibilityScope[]` → `buildAiVisibility`（T15.4）→
 * **持久化分析結果 + 指標**（`ai_answers`/`ai_cited_references`/`ai_visibility_metrics`，供 T15.6 view）。
 *
 * **partial 降級（AC-42.5/INV-6）**：三線各以 `*Outcome`（保留 needsReview）跑，某 query/某線 LLM 失敗 → 該筆補
 * 預設、**不污染他筆**；三線 `needsReview` 收斂為 job-level `needsReview`（>0 → processor 標 run partial）。
 * **idempotent re-run**：clean-slate by jobId（reset/retry 沿用同一 jobId 不重複落列）。
 *
 * **pipeline stage 抽方法**：`loadBrands`（載入）+ `flattenCaptures`（攤平）+ 三線分析 + `assembleAnalysis`（純函式
 * 組裝：per-answer 聚合 + scope→指標）+ repo 持久化，各自獨立可測。
 *
 * **維度**：本 task 組裝 `keyword` 維度 scope（group=query，直接來自 capture）——`buildAiVisibility` 純函式已支援
 * intent/購買歷程維度（AC-43.3），其 scope 需 query→意圖/歷程映射 join（跨 M2/M12），屬後續接線、非本 task 擋關。
 * **exposure**：本 task scope `searchVolumes=[]`（AI 抓取關鍵字未必在 Search 線）→ exposure=null（null 不補 0，
 * AC-43.1 合法狀態）；接上 Search 線搜量後填入即可。
 */
@Injectable()
export class AiAnalysisService {
  // narrow 介面型別 + `@Inject(具體類 token)`：DI 照舊解析具體服務，但建構子參數非 class-typed → 無
  // emitDecoratorMetadata `typeof X==='function'?X:Object` phantom branch（同時 depend on abstraction）。
  constructor(
    @Inject(BrandExtractionService) private readonly brands: BrandExtractor,
    @Inject(SentimentService) private readonly sentiment: SentimentAnalyzer,
    @Inject(MediaClassifierService) private readonly media: CitedMediaClassifier,
    @Inject(AiAnalysisRepository) private readonly repo: AiAnalysisStore,
    private readonly prisma: PrismaService,
    @Inject(AI_ANALYSIS_CONFIG) private readonly config: AiAnalysisConfig,
  ) {}

  async analyzeAndPersist(input: AnalyzeAndPersistInput): Promise<AiAnalysisResult> {
    const { jobId, ownerId, brandProfileId, captures } = input;
    const { schemaVersion } = this.config;
    if (captures.length === 0) {
      // idempotent re-run clean-slate：reset 後零 capture 仍須清舊列（無新列可寫），原子 replace 空集。
      await this.repo.replaceForJob(jobId, ownerId, schemaVersion, {
        answers: [],
        cited: [],
        metrics: [],
      });
      return { answersCount: 0, citedCount: 0, metricsCount: 0, needsReview: 0 };
    }

    const brands = await this.loadBrands(brandProfileId, ownerId);
    const { contexts, textBlocks, mediaRefs } = flattenCaptures(captures);

    // 三線分析（各保留 needsReview 供 job-level partial 收斂，AC-42.5）。sentiment 需目標本品牌；無 → 略過（全 0）。
    const brandOutcome = await this.brands.extractBrandsOutcome(textBlocks, brands.aliases);
    const sentimentOutcome = brands.primary
      ? await this.sentiment.analyzeSentimentOutcome(brands.primary, textBlocks)
      : { results: [], needsReview: [] };
    const mediaOutcome = await this.media.classifyMediaOutcome(mediaRefs);

    // 組裝（純函式）：per-answer 聚合（brands/情緒/media）+ per-scope（channel×query）攤成可見度指標列。
    const { answers, cited, metrics } = assembleAnalysis(
      contexts,
      {
        brandById: new Map(brandOutcome.results.map((r) => [r.id, r.brands])),
        sentimentById: new Map(sentimentOutcome.results.map((r) => [r.id, r])),
        mediaById: new Map(mediaOutcome.results.map((r) => [r.id, r.type])),
      },
      brands.visibilityBrands,
    );

    // 原子持久化（M15-R8/#689）：delete + 三 createMany 收斂單一 `$transaction`（全有或全無，不跨表撕裂）。
    const { answersCount, citedCount, metricsCount } = await this.repo.replaceForJob(
      jobId,
      ownerId,
      schemaVersion,
      { answers, cited, metrics },
    );

    const needsReview =
      brandOutcome.needsReview.length +
      sentimentOutcome.needsReview.length +
      mediaOutcome.needsReview.length;

    return { answersCount, citedCount, metricsCount, needsReview };
  }

  /**
   * 載入品牌檔案（owner 分範圍，S8 唯一單點——經 {@link ownerWhereFromOwnerId} 由 run 落庫的 `ownerId` 推導
   * scope：session 建立 → 自己 + 共享（null）；機器/apiKey 建立 → 不過濾。不可存取的列→視同無品牌，不跨 owner 讀）
   * → 報告品牌集（本品牌 + 競品）。無 brandProfileId / 查無 → 空集（demo/空品牌集不硬崩，AC-40.3；
   * buildAiVisibility 對空品牌回 0 列）。
   */
  private async loadBrands(
    brandProfileId: string | null,
    ownerId: string | null,
  ): Promise<LoadedBrands> {
    if (!brandProfileId) {
      return { visibilityBrands: [], aliases: [], primary: null };
    }
    const row = await this.prisma.brandProfile.findFirst({
      where: { id: brandProfileId, ...ownerWhereFromOwnerId(ownerId) },
    });
    if (!row) {
      return { visibilityBrands: [], aliases: [], primary: null };
    }
    const view = toBrandProfileView(row);
    const all = [view.brand, ...view.competitors];
    return {
      visibilityBrands: all.map((b) => ({ name: b.name, sites: b.sites })),
      aliases: all.map((b) => ({ name: b.name, aliases: b.aliases })),
      primary: { name: view.brand.name, aliases: view.brand.aliases },
    };
  }
}

/**
 * 組裝層（純函式）：把 per-input 三線結果對回 per-answer（ai_answers）+ per-reference（ai_cited_references）+
 * per (channel × keyword × brand) 指標（`buildAiVisibility`）。scope key = `channel × normalizeText(query)`
 * （S4 同去重/快取一套）；group 存首見原字（顯示用）。同 (channel,query) 多 captures 聚合為單一 scope。
 */
function assembleAnalysis(
  contexts: readonly CaptureContext[],
  index: AnalysisIndex,
  visibilityBrands: readonly VisibilityBrand[],
): { answers: AiAnswerRow[]; cited: AiCitedReferenceRow[]; metrics: AiVisibilityMetricRow[] } {
  const answers: AiAnswerRow[] = [];
  const cited: AiCitedReferenceRow[] = [];
  const scopes = new Map<string, AiVisibilityScope & { mentions: string[]; citations: string[] }>();

  for (const ctx of contexts) {
    const answerBrands = ctx.blockIds.flatMap((id) => index.brandById.get(id) ?? []);
    let positive = 0;
    let negative = 0;
    for (const id of ctx.blockIds) {
      const sentiment = index.sentimentById.get(id);
      if (sentiment) {
        positive += sentiment.positive;
        negative += sentiment.negative;
      }
    }
    answers.push({
      channel: ctx.channel,
      query: ctx.query,
      answerText: ctx.texts.join('\n\n'),
      brands: answerBrands,
      positive,
      negative,
    });
    for (const ref of ctx.refs) {
      cited.push({
        channel: ctx.channel,
        query: ctx.query,
        link: ref.link,
        domain: normalizeDomain(ref.link),
        title: ref.title,
        mediaType: index.mediaById.get(ref.id) ?? 'other',
      });
    }
    const key = `${ctx.channel} ${normalizeText(ctx.query)}`;
    let scope = scopes.get(key);
    if (!scope) {
      scope = {
        channel: ctx.channel,
        dimension: 'keyword',
        group: ctx.query,
        mentions: [],
        citations: [],
        searchVolumes: [],
      };
      scopes.set(key, scope);
    }
    scope.mentions.push(...answerBrands);
    scope.citations.push(...ctx.refs.map((r) => r.link));
  }

  const metrics = buildAiVisibility([...scopes.values()], visibilityBrands).map((cell) => ({
    channel: cell.channel,
    dimension: cell.dimension,
    groupKey: cell.group,
    brand: cell.brand,
    mentions: cell.mentions,
    shareOfVoice: cell.shareOfVoice,
    citations: cell.citations,
    exposure: cell.exposure,
  }));

  return { answers, cited, metrics };
}

/** 攤平 captures：合成 block/reference id（`${c}::${b}`）、抽 block 文字、收 references；回線輸入 + per-capture 語境。 */
function flattenCaptures(captures: readonly AiSearchCanonical[]): {
  contexts: CaptureContext[];
  textBlocks: Array<{ id: string; text: string }>;
  mediaRefs: Array<{ id: string; link: string }>;
} {
  const contexts: CaptureContext[] = [];
  const textBlocks: Array<{ id: string; text: string }> = [];
  const mediaRefs: Array<{ id: string; link: string }> = [];
  captures.forEach((capture, c) => {
    const blockIds: string[] = [];
    const texts: string[] = [];
    capture.blocks.forEach((block, b) => {
      const id = `${c}::b${b}`;
      const text = coerceBlockText(block);
      textBlocks.push({ id, text });
      blockIds.push(id);
      texts.push(text);
    });
    const refs = capture.references.map((ref, r) => {
      const id = `${c}::r${r}`;
      mediaRefs.push({ id, link: ref.link });
      return { id, link: ref.link, title: ref.title };
    });
    contexts.push({ channel: capture.channel, query: capture.query, blockIds, texts, refs });
  });
  return { contexts, textBlocks, mediaRefs };
}

/** 中立化 block（`unknown`）→ LLM 可讀文字：字串原樣、數值/布林 String()、物件取常見文字欄或 JSON 序列化、其餘空。 */
function coerceBlockText(block: unknown): string {
  if (typeof block === 'string') {
    return block;
  }
  if (typeof block === 'number' || typeof block === 'boolean' || typeof block === 'bigint') {
    return String(block);
  }
  if (block !== null && typeof block === 'object') {
    const record = block as Record<string, unknown>;
    for (const key of ['text', 'content', 'snippet', 'markdown']) {
      const value = record[key];
      if (typeof value === 'string') {
        return value;
      }
    }
    return JSON.stringify(block);
  }
  return ''; // null / undefined / symbol / function → 無可分析文字
}
