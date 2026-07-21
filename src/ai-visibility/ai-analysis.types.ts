import type { BrandAliasInput } from '../brand-profile/brand-match';
import type { BlockBrands, BrandTextBlock } from './brand-extraction.postprocess';
import type { BlockMedia, MediaReference } from './media-classifier.postprocess';
import type { BlockSentiment, SentimentTextBlock } from './sentiment.postprocess';

/**
 * M15 AI 分析 job 編排（T15.5，FR-42/AC-42.5）的共用型別 + narrow DI 契約。三線 AI 回答分析（品牌/情緒/媒體，
 * T15.2/T15.3）的線輸出擴充為「per-input 後處理列 + 降級輸入項（needsReview）」——**job-level partial 收斂點**
 * （T15.3 服務公開方法僅回 per-input 列、drop per-item needsReview，此處由 `*Outcome` 姊妹方法重新暴露）。
 *
 * `AiAnalysisService` 以下列**窄介面**依賴三線服務 + 持久層（depend on abstraction）——編排只需這些能力，且以
 * `@Inject(具體類 token)` 注入（介面型別 → 建構子無 class-typed 參數的 emitDecoratorMetadata phantom branch）。
 */

/**
 * 單一分析線的輸出：`results`=每個輸入恰一列（缺漏/降級由各 postProcess 補預設，**不污染他筆**）；
 * `needsReview`=LLM 降級 fallback（content_filter/refusal/malformed/length 拆到底）的輸入項——**>0 即該線降級**。
 */
export interface AnalysisLineOutcome<T, I> {
  results: T[];
  needsReview: I[];
}

/**
 * `AiAnalysisService.analyzeAndPersist` 結果（供 processor 收斂 job 狀態）。
 * `needsReview`=三線降級輸入總數；**>0 → job-level partial**（AC-42.5/INV-6，某 query/某線 LLM 失敗不整批失敗）。
 */
export interface AiAnalysisResult {
  answersCount: number;
  citedCount: number;
  metricsCount: number;
  needsReview: number;
}

/** 品牌抽取線 narrow 契約（BrandExtractionService 實作）。 */
export interface BrandExtractor {
  extractBrandsOutcome(
    blocks: BrandTextBlock[],
    profileBrands?: BrandAliasInput[],
  ): Promise<AnalysisLineOutcome<BlockBrands, BrandTextBlock>>;
}

/** 情緒線 narrow 契約（SentimentService 實作）。 */
export interface SentimentAnalyzer {
  analyzeSentimentOutcome(
    brand: BrandAliasInput,
    blocks: SentimentTextBlock[],
  ): Promise<AnalysisLineOutcome<BlockSentiment, SentimentTextBlock>>;
}

/** 引用媒體分類線 narrow 契約（MediaClassifierService 實作）。 */
export interface CitedMediaClassifier {
  classifyMediaOutcome(
    refs: MediaReference[],
  ): Promise<AnalysisLineOutcome<BlockMedia, MediaReference>>;
}

/** 一列 AI 回答分析結果（ai_answers）。`brands`=露出次數不去重（S17）；`positive`/`negative`=本品牌褒/貶累計。 */
export interface AiAnswerRow {
  channel: string;
  query: string;
  answerText: string;
  brands: string[];
  positive: number;
  negative: number;
}

/** 一列引用媒體分類（ai_cited_references）；`mediaType`=9-enum（AC-42.3）。 */
export interface AiCitedReferenceRow {
  channel: string;
  query: string;
  link: string;
  domain: string;
  title: string | null;
  mediaType: string;
}

/** 一列可見度指標（ai_visibility_metrics）；`AiVisibilityCell`（T15.4）攤平（`group`→`groupKey`）。 */
export interface AiVisibilityMetricRow {
  channel: string;
  dimension: string;
  groupKey: string;
  brand: string;
  mentions: number;
  shareOfVoice: number | null;
  citations: number;
  exposure: number | null;
}

/** AI 分析結果持久層 narrow 契約（AiAnalysisRepository 實作）。 */
export interface AiAnalysisStore {
  deleteByJobId(jobId: string): Promise<void>;
  persistAnswers(
    jobId: string,
    ownerId: string | null,
    schemaVersion: string,
    rows: readonly AiAnswerRow[],
  ): Promise<number>;
  persistCitedReferences(
    jobId: string,
    ownerId: string | null,
    schemaVersion: string,
    rows: readonly AiCitedReferenceRow[],
  ): Promise<number>;
  persistMetrics(
    jobId: string,
    ownerId: string | null,
    schemaVersion: string,
    rows: readonly AiVisibilityMetricRow[],
  ): Promise<number>;
}
