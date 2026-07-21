import { Inject, Injectable } from '@nestjs/common';
import type { BrandAliasInput } from '../brand-profile/brand-match';
import {
  INTENT_LABELER,
  type IntentLabeler,
  type ParseChatResult,
} from '../intent/intent-labeler.port';
import type { AnalysisLineOutcome } from './ai-analysis.types';
import {
  MAX_COMPLETION_TOKENS,
  type LlmBatchConfig,
  ResilientLlmBatchService,
} from './llm-batch-pipeline';
import { buildSentimentMessages } from './sentiment.prompt';
import { type SentimentResult, sentimentResponseFormat } from './sentiment.schema';
import {
  type BlockSentiment,
  type SentimentTextBlock,
  postProcessSentiment,
} from './sentiment.postprocess';

/** DI token for SentimentService 設定（batch/concurrency；由 module 從 config 組裝）。 */
export const SENTIMENT_CONFIG = Symbol('SENTIMENT_CONFIG');

/** LLM 單筆情緒結果（resilientChunk 的 `R`；＝ SentimentResult 的元素型別）。 */
type SentimentResultItem = SentimentResult['results'][number];

/**
 * AI 回答品牌情緒 pipeline（T15.3，FR-42/AC-42.2 / S17 / NFR-19，TC-78 部分）。**繼承共用批次骨架**
 * {@link ResilientLlmBatchService}（切批 + 全域 p-limit + resilientChunk length 拆批 / refusal fallback），
 * 對一組 id'd text block 逐段判**目標品牌**（`BrandProfile` name+aliases，FR-40）的褒/貶。
 *
 * `analyzeSentiment(brand, blocks)`：經 T15.1 `buildSentimentMessages`（注入隔離：目標品牌進 system 第一方
 * 語境、blocks 為 boundaried user data）送 LLM → `postProcessSentiment` 保證**每 block 恰一列**、缺漏/降級
 * 補 `{0,0}`（partial 不污染他筆），**S17 褒貶混合各 +1 原樣保留**（不 collapse）。
 */
@Injectable()
export class SentimentService extends ResilientLlmBatchService {
  constructor(
    @Inject(INTENT_LABELER) private readonly labeler: IntentLabeler,
    @Inject(SENTIMENT_CONFIG) config: LlmBatchConfig,
  ) {
    super(config);
  }

  /**
   * 韌性判定 blocks 對目標 `brand` 的情緒，回最終 `BlockSentiment[]`（每 block 恰一列、依輸入順序）。
   * 空輸入 → `[]`、不呼叫 LLM。
   */
  async analyzeSentiment(
    brand: BrandAliasInput,
    blocks: SentimentTextBlock[],
  ): Promise<BlockSentiment[]> {
    return (await this.analyzeSentimentOutcome(brand, blocks)).results;
  }

  /**
   * 同 {@link analyzeSentiment}，但**保留** `needsReview`（降級 fallback 的輸入 block）——供 T15.5 job-level
   * partial 收斂（AC-42.5/INV-6）。`analyzeSentiment` 委派此方法後 drop `needsReview`（維持既有公開契約）。
   */
  async analyzeSentimentOutcome(
    brand: BrandAliasInput,
    blocks: SentimentTextBlock[],
  ): Promise<AnalysisLineOutcome<BlockSentiment, SentimentTextBlock>> {
    const { collected, needsReview } = await this.runBatches<
      SentimentResultItem,
      SentimentTextBlock
    >(blocks, (chunk) => this.callBatch(brand, chunk));
    return { results: postProcessSentiment(blocks, { results: collected }), needsReview };
  }

  /** 單批 LLM 呼叫（固定 strict `brand_sentiment` schema、temperature=0、max tokens；目標品牌注入 system）。 */
  private callBatch(
    brand: BrandAliasInput,
    chunk: SentimentTextBlock[],
  ): Promise<ParseChatResult<SentimentResult>> {
    const responseFormat = sentimentResponseFormat();
    return this.labeler.parseChat<SentimentResult>({
      messages: buildSentimentMessages(brand, chunk),
      jsonSchema: {
        name: responseFormat.json_schema.name,
        schema: responseFormat.json_schema.schema as Record<string, unknown>,
      },
      temperature: 0,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
    });
  }
}
