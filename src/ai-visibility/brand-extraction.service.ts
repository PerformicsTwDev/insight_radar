import { Inject, Injectable } from '@nestjs/common';
import pLimit from 'p-limit';
import type { BrandAliasInput } from '../brand-profile/brand-match';
import { sanitizePositiveInt } from '../common/sanitize-positive-int';
import {
  INTENT_LABELER,
  type IntentLabeler,
  type ParseChatResult,
} from '../intent/intent-labeler.port';
import { type ChunkOutcome, resilientChunk } from '../intent/resilient-batch';
import { buildBrandExtractionMessages } from './brand-extraction.prompt';
import {
  type BrandExtractionResult,
  brandExtractionResponseFormat,
} from './brand-extraction.schema';
import {
  type BlockBrands,
  type BrandTextBlock,
  postProcessBrands,
} from './brand-extraction.postprocess';

/** 上限 completion tokens（避免 `finish_reason=length` 截斷；沿用 intent/journey ~4000）。 */
const MAX_COMPLETION_TOKENS = 4000;
/** 預設每批 block 數（沿用 LLM 批量慣例，預設 30）。 */
const DEFAULT_BATCH_SIZE = 30;
/** 預設 LLM 並發上限（沿用 `LLM_CONCURRENCY`，預設 6）。 */
const DEFAULT_LLM_CONCURRENCY = 6;

/** LLM 單筆抽取結果（resilientChunk 的 `R`）。 */
type BrandResult = { id: string; brands: string[] };

/** DI token for BrandExtractionService 設定（batch/concurrency；由 module 從 config 組裝）。 */
export const BRAND_EXTRACTION_CONFIG = Symbol('BRAND_EXTRACTION_CONFIG');

export interface BrandExtractionServiceConfig {
  batchSize: number;
  /** LLM 並發上限（p-limit）；省略 → 預設 6。 */
  llmConcurrency?: number;
}

/**
 * AI 回答品牌抽取 pipeline（T15.2，FR-42/AC-42.1 / NFR-19，TC-78 部分）。**類比 M2 IntentService**
 * （batch/length 拆批/refusal fallback），對 id'd text block 抽品牌。
 *
 * `extractBrands(blocks, profileBrands?)`：以 batchSize 切批、共用 `resilientChunk`（length 對半拆 /
 * content_filter·refusal fallback，**複用 intent 骨架**）並發送 LLM（經 T15.1 `buildBrandExtractionMessages`
 * 注入隔離）→ `postProcessBrands` 保證**每 block 恰一列**、依 `BrandProfile.aliases` 正規化（`華碩→ASUS`）、
 * **刻意不去重＝露出次數**（S17）。無 profile → 不硬崩（AC-40.3）。抽取結果為暫態；持久化/指標另屬 T15.4/T15.5。
 */
@Injectable()
export class BrandExtractionService {
  private readonly batchSize: number;
  private readonly llmConcurrency: number;
  /** 全域 LLM 並發限流器：singleton 上所有 extract 共用（全域並發上限 = llmConcurrency、不隨 worker 倍增）。 */
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(
    @Inject(INTENT_LABELER) private readonly labeler: IntentLabeler,
    @Inject(BRAND_EXTRACTION_CONFIG) config: BrandExtractionServiceConfig,
  ) {
    this.batchSize = sanitizePositiveInt(config.batchSize, DEFAULT_BATCH_SIZE);
    this.llmConcurrency = sanitizePositiveInt(config.llmConcurrency, DEFAULT_LLM_CONCURRENCY);
    this.limit = pLimit(this.llmConcurrency);
  }

  /**
   * 韌性抽取 blocks 的品牌，回最終 `BlockBrands[]`（每 block 恰一列、依輸入順序；brands **不去重**＝露出次數）。
   * `profileBrands` 省略/空 → 不做 canonical 正規化（原樣保留、不硬崩）。
   */
  async extractBrands(
    blocks: BrandTextBlock[],
    profileBrands: BrandAliasInput[] = [],
  ): Promise<BlockBrands[]> {
    if (blocks.length === 0) {
      return [];
    }
    // 以 batchSize 切批、共用 limiter 並發送 LLM（達批即派、全域 RPM 受控）。
    const tasks: Promise<ChunkOutcome<BrandResult, BrandTextBlock>>[] = [];
    for (let i = 0; i < blocks.length; i += this.batchSize) {
      const chunk = blocks.slice(i, i + this.batchSize);
      tasks.push(this.limit(() => this.extractChunk(chunk)));
    }
    const outcomes = await Promise.all(tasks);
    const collected = outcomes.flatMap((o) => o.collected);
    return postProcessBrands(blocks, { results: collected }, profileBrands);
  }

  /** 抽取單批（韌性遞迴由共用 {@link resilientChunk} 承擔；length 對半拆 / content_filter·refusal fallback）。 */
  private extractChunk(
    chunk: BrandTextBlock[],
  ): Promise<ChunkOutcome<BrandResult, BrandTextBlock>> {
    return resilientChunk<BrandResult, BrandTextBlock>(chunk, (c) => this.callBatch(c));
  }

  private callBatch(chunk: BrandTextBlock[]): Promise<ParseChatResult<BrandExtractionResult>> {
    const responseFormat = brandExtractionResponseFormat();
    return this.labeler.parseChat<BrandExtractionResult>({
      messages: buildBrandExtractionMessages(chunk),
      jsonSchema: {
        name: responseFormat.json_schema.name,
        schema: responseFormat.json_schema.schema as Record<string, unknown>,
      },
      temperature: 0,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
    });
  }
}
