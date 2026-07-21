import { Inject, Injectable } from '@nestjs/common';
import type { BrandAliasInput } from '../brand-profile/brand-match';
import { INTENT_LABELER, type IntentLabeler } from '../intent/intent-labeler.port';
import type { LlmBatchConfig } from './llm-batch-pipeline';
import type { BlockSentiment, SentimentTextBlock } from './sentiment.postprocess';

/** DI token for SentimentService 設定（batch/concurrency；由 module 從 config 組裝）。 */
export const SENTIMENT_CONFIG = Symbol('SENTIMENT_CONFIG');

/**
 * AI 回答品牌情緒 pipeline（RED 空殼，T15.3；FR-42/AC-42.2 / S17，TC-78 部分）。green 時共用批次骨架
 * （切批 + resilientChunk length 拆批 / refusal fallback）逐 block 判目標品牌情緒。
 */
@Injectable()
export class SentimentService {
  constructor(
    @Inject(INTENT_LABELER) _labeler: IntentLabeler,
    @Inject(SENTIMENT_CONFIG) _config: LlmBatchConfig,
  ) {}

  analyzeSentiment(
    _brand: BrandAliasInput,
    _blocks: SentimentTextBlock[],
  ): Promise<BlockSentiment[]> {
    return Promise.reject(
      new Error('SentimentService.analyzeSentiment not implemented (T15.3 red)'),
    );
  }
}
