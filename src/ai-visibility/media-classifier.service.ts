import { Inject, Injectable } from '@nestjs/common';
import { INTENT_LABELER, type IntentLabeler } from '../intent/intent-labeler.port';
import type { LlmBatchConfig } from './llm-batch-pipeline';
import type { BlockMedia, MediaReference } from './media-classifier.postprocess';

/** DI token for MediaClassifierService 設定（batch/concurrency；由 module 從 config 組裝）。 */
export const MEDIA_CLASSIFIER_CONFIG = Symbol('MEDIA_CLASSIFIER_CONFIG');

/**
 * AI 回答引用媒體分類 pipeline（RED 空殼，T15.3；FR-42/AC-42.3，TC-78 部分）。green 時共用批次骨架
 * （切批 + resilientChunk length 拆批 / refusal fallback）依 reference domain 判 9 類媒體 enum。
 */
@Injectable()
export class MediaClassifierService {
  constructor(
    @Inject(INTENT_LABELER) _labeler: IntentLabeler,
    @Inject(MEDIA_CLASSIFIER_CONFIG) _config: LlmBatchConfig,
  ) {}

  classifyMedia(_refs: MediaReference[]): Promise<BlockMedia[]> {
    return Promise.reject(
      new Error('MediaClassifierService.classifyMedia not implemented (T15.3 red)'),
    );
  }
}
