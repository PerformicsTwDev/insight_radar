import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BrandAliasInput } from '../brand-profile/brand-match';
import { toBrandProfileView } from '../brand-profile/brand-profile.mapper';
import type { CaptureChannel } from '../captures/dto/capture-ingest.dto';
import type { AiSearchCanonical } from '../captures/mapping/canonical.types';
import { ownerWhereFromOwnerId } from '../common/owner-scope';
import { normalizeText } from '../google-ads/normalize';
import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import { scrubSecrets } from '../logger/redaction';
import { PrismaService } from '../prisma';
import { type AiTextBlockInput, aiTextBlockSchema } from './ai-answer-content.schema';
import { AiAnalysisRepository } from './ai-analysis.repository';
import type {
  AiAnalysisResult,
  AiAnalysisStore,
  AiAnswerRow,
  AiCitedReferenceRow,
  AiVisibilityMetricRow,
  AnalysisLineOutcome,
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
  type VisibilityDimension,
  buildAiVisibility,
  normalizeDomain,
} from './visibility-metrics';

/**
 * query→維度映射（#678 G3，AC-43.3）：`intentByNt`＝normalizedText → 意圖類別（M2 `keyword_intents`）；
 * `stageByNt`＝normalizedText → 購買歷程階段（FR-33 `keyword_journey_assignments`，linked analysis 之 snapshot）。
 * 空 Map（standalone job / 未分類）→ 僅 keyword 維度（無 intent/journey，無回歸）。
 *
 * **exposure（#678 G4，AC-43.1）**：`volumeByNt`＝normalizedText → Search 線 `avgMonthlySearches`（linked
 * analysis 的**不可變 snapshot 列**，即 keywords/journey/custom view 讀取的同一份 per-analysis Search 線）。
 * **value=null**＝該字缺量（不補 0）；**key 缺**（standalone / 非 Search 線字）→ 查得 undefined，組裝層以 null
 * 貢獻（不計入 exposure）。真實 `0` 保留（≠ null）。
 */
export interface DimensionMappings {
  intentByNt: Map<string, string[]>;
  stageByNt: Map<string, string>;
  volumeByNt: Map<string, number | null>;
}

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
 * **維度（#678 G3，AC-43.3）**：除 `keyword` 維度 scope（group=query）外，另依 `loadDimensionMappings` 的
 * query→意圖（M2 `keyword_intents`）/購買歷程（FR-33 `keyword_journey_assignments`）映射加 intent/journey 維度
 * scope（分表互補、不覆寫，S10）。
 * **exposure（#678 G4，AC-43.1）**：scope `searchVolumes` 接 Search 線 `avgMonthlySearches`（linked analysis 之
 * 不可變 snapshot，by `normalizedText`；scope 內去重）→ `sumExposure` 加總——**null 不補 0、全 null/空→null、
 * 真實 0 保留**（比照 micros/cpc null≠0）。非 Search 線字（standalone / 未收錄）→ 該字 null 貢獻、不計入。
 */
@Injectable()
export class AiAnalysisService {
  private readonly logger = new Logger(AiAnalysisService.name);

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

    // 三線分析（各保留 needsReview 供 job-level partial 收斂，AC-42.5）。每線經 {@link runLine} per-line guard：
    // 某線 non-content_filter 基礎設施錯（Azure 500/timeout……——content_filter/length 已由 resilientChunk 內部降級
    // 不 throw）→ 補空結果 + 全部輸入入 needsReview（→ partial），**不丟他線成功結果、不整體 throw**（M15-R3/#685
    // INV-6）。sentiment 需目標本品牌；無 → 略過（全 0，非降級）。
    const primary = brands.primary;
    const brandOutcome = await this.runLine('brand', textBlocks, () =>
      this.brands.extractBrandsOutcome(textBlocks, brands.aliases),
    );
    const sentimentOutcome = primary
      ? await this.runLine('sentiment', textBlocks, () =>
          this.sentiment.analyzeSentimentOutcome(primary, textBlocks),
        )
      : { results: [], needsReview: [] };
    const mediaOutcome = await this.runLine('media', mediaRefs, () =>
      this.media.classifyMediaOutcome(mediaRefs),
    );

    // query→意圖/購買歷程維度映射（#678 G3，AC-43.3）：intent 全域 by normalizedText、journey by linked snapshot。
    const dimensions = await this.loadDimensionMappings(jobId, captures);

    // 組裝（純函式）：per-answer 聚合（brands/情緒/media）+ per-scope（channel×dimension×group）攤成可見度指標列。
    const { answers, cited, metrics } = assembleAnalysis(
      contexts,
      {
        brandById: new Map(brandOutcome.results.map((r) => [r.id, r.brands])),
        sentimentById: new Map(sentimentOutcome.results.map((r) => [r.id, r])),
        mediaById: new Map(mediaOutcome.results.map((r) => [r.id, r.type])),
      },
      brands.visibilityBrands,
      dimensions,
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

  /**
   * 單線 per-line guard（M15-R3/#685，INV-6）：跑某分析線；正常回其 `AnalysisLineOutcome`。若該線 throw
   * （**已耗盡 SDK retry 的基礎設施錯**——content_filter/length 由 `resilientChunk` 內部降級不 throw）→ 補**空
   * 結果**（`assembleAnalysis` 對缺 id 補預設：空 brands / 情緒 {0,0} / media `other`）+ 把該線**全部輸入**收入
   * `needsReview`（→ job-level partial），**不丟他線成功結果、不讓錯冒出整個 `analyzeAndPersist`**。
   */
  private async runLine<T, I>(
    line: string,
    inputs: readonly I[],
    run: () => Promise<AnalysisLineOutcome<T, I>>,
  ): Promise<AnalysisLineOutcome<T, I>> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(
        `analysis line '${line}' failed, degrading run to partial: ${scrubSecrets(String(error))}`,
      );
      return { results: [], needsReview: [...inputs] };
    }
  }

  /**
   * 載入 query→意圖/購買歷程維度映射（#678 G3，AC-43.3；**分表互補、不覆寫**，S10）：
   * - **意圖類別**：`keyword_intents`（M2，全域 by `normalizedText`，取最新 `labeledAt`）——即使 standalone job 亦可 join。
   * - **購買歷程**：`keyword_journey_assignments`（FR-33，by snapshot）——由 jobId＝`AiSearchRun.id` 解出 linked
   *   `keywordAnalysisId` → analysis 的 `resultSnapshotId` → 該 snapshot 的階段指派；無 linked analysis / 無 snapshot /
   *   無指派 → 空 Map（僅 keyword 維度，無回歸）。
   *
   * **意圖類別/主題、購買歷程本身語意一律不變**——僅把每字既有的意圖/歷程當作 AI 可見度指標的**額外分組維度**。
   */
  private async loadDimensionMappings(
    jobId: string,
    captures: readonly AiSearchCanonical[],
  ): Promise<DimensionMappings> {
    const nts = [...new Set(captures.map((capture) => normalizeText(capture.query)))];
    const intentByNt = new Map<string, string[]>();
    const stageByNt = new Map<string, string>();
    const volumeByNt = new Map<string, number | null>();
    if (nts.length === 0) {
      return { intentByNt, stageByNt, volumeByNt };
    }

    // 意圖：全域 by normalizedText，取最新 labeledAt（同字多 modelVersion → 取最新）。
    const intents = await this.prisma.keywordIntent.findMany({
      where: { normalizedText: { in: nts } },
      orderBy: { labeledAt: 'desc' },
      select: { normalizedText: true, labels: true },
    });
    for (const row of intents) {
      if (!intentByNt.has(row.normalizedText)) {
        intentByNt.set(row.normalizedText, (row.labels as string[] | null) ?? []);
      }
    }

    // 購買歷程（G3）+ Search 線 avgMonthlySearches（G4）：jobId＝AiSearchRun.id → linked keywordAnalysisId →
    // resultSnapshotId → 同一 snapshot 的階段指派 + 不可變列（Search 線）。無 linked analysis / 無 snapshot → 兩者皆空。
    const run = await this.prisma.aiSearchRun.findUnique({
      where: { id: jobId },
      select: { keywordAnalysisId: true },
    });
    if (run?.keywordAnalysisId) {
      const analysis = await this.prisma.keywordAnalysis.findUnique({
        where: { id: run.keywordAnalysisId },
        select: { resultSnapshotId: true },
      });
      if (analysis?.resultSnapshotId) {
        const assignments = await this.prisma.keywordJourneyAssignment.findMany({
          where: { snapshotId: analysis.resultSnapshotId, normalizedText: { in: nts } },
          select: { normalizedText: true, stage: true },
        });
        for (const assignment of assignments) {
          stageByNt.set(assignment.normalizedText, assignment.stage);
        }
        // Search 線＝該 analysis 的**不可變 snapshot 列**（keywords/journey/custom view 讀取的同一份，
        // AC-43.1 as-built）。`avgMonthlySearches` 藏於 `snapshot_rows.data` JSON（無 normalizedText 欄可 DB 篩）
        // → 載列後以 nts 集記憶體篩、by normalizedText 建映射。**value 保留 null**（缺量不補 0）、真實 0 保留。
        const ntSet = new Set(nts);
        const rows = await this.prisma.snapshotRow.findMany({
          where: { snapshotId: analysis.resultSnapshotId },
          select: { data: true },
        });
        for (const { data } of rows) {
          const row = data as unknown as SnapshotRowData;
          if (ntSet.has(row.normalizedText)) {
            volumeByNt.set(row.normalizedText, row.avgMonthlySearches);
          }
        }
      }
    }
    return { intentByNt, stageByNt, volumeByNt };
  }
}

/**
 * 組裝層（純函式）：把 per-input 三線結果對回 per-answer（ai_answers）+ per-reference（ai_cited_references）+
 * per (channel × dimension × group × brand) 指標（`buildAiVisibility`）。scope key = `channel × dimension ×
 * normalizeText(group)`（S4 同去重/快取一套）；group 存原字/類別/階段（顯示用）。同 scope 多 captures 聚合。
 *
 * **維度（#678 G3，AC-43.3）**：每筆 capture 除既有 **keyword** 維度（group=query）外，另依 `dimensions` 映射
 * 加 **intent**（group=意圖類別，每類別一 scope）與 **journey**（group=購買歷程階段）維度 scope——同一露出（mentions）
 * /引用（citations）沿用（**意圖/歷程語意不變、僅加分組維度**）。空映射（standalone / 未分類）→ 僅 keyword 維度。
 *
 * **exposure（#678 G4，AC-43.1）**：每 scope 收集其涉及的**相異**關鍵字 `normalizedText`（`keywordNts`），末段以
 * `dimensions.volumeByNt` 取 Search 線 `avgMonthlySearches` materialize `searchVolumes`（缺量/非 Search 線字→null）；
 * `buildAiVisibility`→`sumExposure` 加總（**null 不補 0、全 null/空→null、真實 0 保留**）。
 */
function assembleAnalysis(
  contexts: readonly CaptureContext[],
  index: AnalysisIndex,
  visibilityBrands: readonly VisibilityBrand[],
  dimensions: DimensionMappings,
): { answers: AiAnswerRow[]; cited: AiCitedReferenceRow[]; metrics: AiVisibilityMetricRow[] } {
  const answers: AiAnswerRow[] = [];
  const cited: AiCitedReferenceRow[] = [];
  // scope 累積器：searchVolumes 於末段由 `keywordNts`（範疇內**相異**關鍵字 normalizedText）materialize（G4 去重）。
  const scopes = new Map<
    string,
    Omit<AiVisibilityScope, 'searchVolumes'> & {
      mentions: string[];
      citations: string[];
      keywordNts: Set<string>;
    }
  >();

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
    // 每筆 capture 攤成 keyword + intent(每類別) + journey(階段) 維度 scope（G3）。
    const refLinks = ctx.refs.map((r) => r.link);
    const queryNt = normalizeText(ctx.query); // 該 capture 關鍵字（S4 同去重/快取一套；exposure by 此 key）。
    for (const { dimension, group } of dimensionsOf(ctx.query, dimensions)) {
      const key = `${ctx.channel} ${dimension} ${normalizeText(group)}`;
      let scope = scopes.get(key);
      if (!scope) {
        scope = {
          channel: ctx.channel,
          dimension,
          group,
          mentions: [],
          citations: [],
          keywordNts: new Set<string>(),
        };
        scopes.set(key, scope);
      }
      scope.mentions.push(...answerBrands);
      scope.citations.push(...refLinks);
      scope.keywordNts.add(queryNt); // 範疇涉及的關鍵字（Set 去重：同字多 capture 不重複計 exposure）。
    }
  }

  // materialize searchVolumes（G4，AC-43.1）：範疇內**相異**關鍵字各取 Search 線 `avgMonthlySearches`；
  // 缺量/非 Search 線字 → null（`sumExposure` 不計入、不補 0）。keyword 維度＝一字；intent/journey＝該範疇多字。
  const scopeList: AiVisibilityScope[] = [...scopes.values()].map((scope) => ({
    channel: scope.channel,
    dimension: scope.dimension,
    group: scope.group,
    mentions: scope.mentions,
    citations: scope.citations,
    searchVolumes: [...scope.keywordNts].map((nt) => dimensions.volumeByNt.get(nt) ?? null),
  }));

  const metrics = buildAiVisibility(scopeList, visibilityBrands).map((cell) => ({
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

/**
 * 某 query 的可見度分組維度（#678 G3）：恆含 **keyword**（group=原字）；另依映射加 **intent**（每意圖類別一列）
 * 與 **journey**（購買歷程階段，至多一列）。`normalizeText(query)` 為映射 key（S4 同去重/快取一套）。
 */
function dimensionsOf(
  query: string,
  dimensions: DimensionMappings,
): Array<{ dimension: VisibilityDimension; group: string }> {
  const nt = normalizeText(query);
  const out: Array<{ dimension: VisibilityDimension; group: string }> = [
    { dimension: 'keyword', group: query },
  ];
  for (const label of dimensions.intentByNt.get(nt) ?? []) {
    out.push({ dimension: 'intent', group: label });
  }
  const stage = dimensions.stageByNt.get(nt);
  if (stage) {
    out.push({ dimension: 'journey', group: stage });
  }
  return out;
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

/**
 * 中立化 block（`unknown`）→ LLM 可讀文字：字串原樣、數值/布林 String()、物件先試 AI-Overview text block 形狀
 * （`aiTextBlockSchema`，含遞迴 `list`），否則取常見文字欄或 JSON 序列化，其餘空。
 *
 * **list block 可讀化（M15-R4/#686）**：AI-Overview `list` block **無 top-level `snippet`**——子項 `snippet`
 * 藏在 `list[]`（可再巢狀）。舊版落至 `JSON.stringify` → 餵 LLM 結構 JSON + `ai_answers.answer_text` 亂碼。改依
 * 本里程碑自帶 `aiTextBlockSchema` 遞迴取 `snippet` 串接成可讀文字；heading/paragraph（有 top-level snippet）亦
 * 由此路取得。schema 全欄 optional 且 strip 未知欄 → 對非 text-block 物件（如 `{html:'x'}`）遞迴取值為空、續走
 * text/content/markdown fallback 或 JSON.stringify（保既有行為）。
 */
function coerceBlockText(block: unknown): string {
  if (typeof block === 'string') {
    return block;
  }
  if (typeof block === 'number' || typeof block === 'boolean' || typeof block === 'bigint') {
    return String(block);
  }
  if (block !== null && typeof block === 'object') {
    const parsed = aiTextBlockSchema.safeParse(block);
    if (parsed.success) {
      const text = flattenTextBlock(parsed.data);
      if (text) {
        return text;
      }
    }
    const record = block as Record<string, unknown>;
    for (const key of ['text', 'content', 'markdown']) {
      const value = record[key];
      if (typeof value === 'string') {
        return value;
      }
    }
    return JSON.stringify(block);
  }
  return ''; // null / undefined / symbol / function → 無可分析文字
}

/**
 * 攤平 AI-Overview text block（`aiTextBlockSchema` 形狀）→ 可讀純文字：本層 `snippet` + 遞迴子 `list` 的
 * snippet，以換行串接（M15-R4）。無 snippet/list（如純 `reference_indexes`）→ 空字串（交由 coerceBlockText fallback）。
 */
function flattenTextBlock(block: AiTextBlockInput): string {
  const parts: string[] = [];
  if (block.snippet) {
    parts.push(block.snippet);
  }
  if (block.list) {
    for (const child of block.list) {
      const childText = flattenTextBlock(child);
      if (childText) {
        parts.push(childText);
      }
    }
  }
  return parts.join('\n');
}
