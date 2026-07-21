import { Inject, Injectable } from '@nestjs/common';
import type { AiSearchCanonical } from '../captures/mapping/canonical.types';
import { PrismaService } from '../prisma';
import { AiAnalysisRepository } from './ai-analysis.repository';
import type { AiAnalysisResult } from './ai-analysis.types';
import { BrandExtractionService } from './brand-extraction.service';
import { MediaClassifierService } from './media-classifier.service';
import { SentimentService } from './sentiment.service';

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

/**
 * AI 分析 job 編排（T15.5，FR-42/AC-42.5；Design §18.4）。把 AI Search 抓取 job 合流的 `AiSearchCapture` →
 * 三線 LLM pipeline（品牌抽取/情緒/媒體，T15.2/T15.3）→ 組裝 `AiVisibilityScope[]` → `buildAiVisibility`（T15.4）→
 * **持久化分析結果 + 指標**（`ai_answers`/`ai_cited_references`/`ai_visibility_metrics`，供 T15.6 view）。
 *
 * **partial 降級（AC-42.5/INV-6）**：某 query/某線 LLM 失敗 → 該筆補預設、**不污染他筆**；三線 `needsReview`
 * 收斂為 job-level `needsReview`（>0 → processor 標 run partial）。**idempotent re-run**：clean-slate by jobId。
 */
@Injectable()
export class AiAnalysisService {
  constructor(
    private readonly brands: BrandExtractionService,
    private readonly sentiment: SentimentService,
    private readonly media: MediaClassifierService,
    private readonly repo: AiAnalysisRepository,
    private readonly prisma: PrismaService,
    @Inject(AI_ANALYSIS_CONFIG) private readonly config: AiAnalysisConfig,
  ) {}

  /** TODO(T15.5 green)：captures → 三線分析 → scopes → buildAiVisibility → 持久化 + partial 收斂。 */
  analyzeAndPersist(_input: AnalyzeAndPersistInput): Promise<AiAnalysisResult> {
    return Promise.resolve({ answersCount: 0, citedCount: 0, metricsCount: 0, needsReview: 0 });
  }
}
