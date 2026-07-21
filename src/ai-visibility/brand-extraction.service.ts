import { Inject, Injectable } from '@nestjs/common';
import type { BrandAliasInput } from '../brand-profile/brand-match';
import {
  INTENT_LABELER,
  type IntentLabeler,
  type ParseChatResult,
} from '../intent/intent-labeler.port';
import { MAX_COMPLETION_TOKENS, ResilientLlmBatchService } from './llm-batch-pipeline';
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

/** LLM 單筆抽取結果（resilientChunk 的 `R`）。 */
type BrandResult = { id: string; brands: string[] };

/** DI token for BrandExtractionService 設定（batch/concurrency；由 module 從 config 組裝）。 */
export const BRAND_EXTRACTION_CONFIG = Symbol('BRAND_EXTRACTION_CONFIG');

/**
 * 品牌抽取批次設定（形狀＝三段分析線共用的 {@link LlmBatchConfig}）。以獨立 interface 宣告（非 `type` 別名）
 * 使 `emitDecoratorMetadata` 對建構子參數渲染 `Object`（無 design:paramtypes 執行期守衛分支）。
 */
export interface BrandExtractionServiceConfig {
  batchSize: number;
  /** LLM 並發上限（p-limit）；省略 → 預設 6。 */
  llmConcurrency?: number;
}

/**
 * AI 回答品牌抽取 pipeline（T15.2，FR-42/AC-42.1 / NFR-19，TC-78 部分）。**繼承共用批次骨架**
 * {@link ResilientLlmBatchService}（T15.3 ③：切批 + 全域 p-limit + `resilientChunk` length 拆批 /
 * content_filter·refusal fallback，與情緒/媒體線共用同一 pipeline），對 id'd text block 抽品牌。
 *
 * `extractBrands(blocks, profileBrands?)`：共用骨架送 LLM（經 T15.1 `buildBrandExtractionMessages` 注入隔離）
 * → `postProcessBrands` 保證**每 block 恰一列**、依 `BrandProfile.aliases` 正規化（`華碩→ASUS`）、**刻意不去重
 * ＝露出次數**（S17）。無 profile → 不硬崩（AC-40.3）。抽取結果為暫態；持久化/指標另屬 T15.4/T15.5。
 */
@Injectable()
export class BrandExtractionService extends ResilientLlmBatchService {
  constructor(
    @Inject(INTENT_LABELER) private readonly labeler: IntentLabeler,
    @Inject(BRAND_EXTRACTION_CONFIG) config: BrandExtractionServiceConfig,
  ) {
    super(config);
  }

  /**
   * 韌性抽取 blocks 的品牌，回最終 `BlockBrands[]`（每 block 恰一列、依輸入順序；brands **不去重**＝露出次數）。
   * `profileBrands` 省略/空 → 不做 canonical 正規化（原樣保留、不硬崩）。空輸入 → `[]`、不呼叫 LLM。
   */
  async extractBrands(
    blocks: BrandTextBlock[],
    profileBrands: BrandAliasInput[] = [],
  ): Promise<BlockBrands[]> {
    const { collected } = await this.runBatches<BrandResult, BrandTextBlock>(blocks, (chunk) =>
      this.callBatch(chunk),
    );
    return postProcessBrands(blocks, { results: collected }, profileBrands);
  }

  /** 單批 LLM 呼叫（固定 strict `brand_extraction` schema、temperature=0、max tokens）。 */
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
