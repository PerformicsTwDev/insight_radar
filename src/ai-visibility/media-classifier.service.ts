import { Inject, Injectable } from '@nestjs/common';
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
import { buildMediaClassifierMessages } from './media-classifier.prompt';
import {
  type MediaClassifierResult,
  mediaClassifierResponseFormat,
} from './media-classifier.schema';
import {
  type BlockMedia,
  type MediaReference,
  postProcessMedia,
} from './media-classifier.postprocess';

/** DI token for MediaClassifierService 設定（batch/concurrency；由 module 從 config 組裝）。 */
export const MEDIA_CLASSIFIER_CONFIG = Symbol('MEDIA_CLASSIFIER_CONFIG');

/** LLM 單筆媒體分類結果（resilientChunk 的 `R`）。type 於後處理清洗成合法 enum。 */
type MediaResultItem = { id: string; type: string };

/**
 * AI 回答引用媒體分類 pipeline（T15.3，FR-42/AC-42.3 / NFR-19，TC-78 部分）。**繼承共用批次骨架**
 * {@link ResilientLlmBatchService}（切批 + 全域 p-limit + resilientChunk length 拆批 / refusal fallback），
 * 依每則 reference 的 domain/subdomain 判 9 類媒體 enum。
 *
 * `classifyMedia(refs)`：經 T15.1 `buildMediaClassifierMessages`（注入隔離：references 為 boundaried user
 * data）送 LLM → `postProcessMedia` 保證**每 reference 恰一列**、非法/缺漏/降級收斂為 `other`（partial 不
 * 污染他筆，AC-42.5）。空輸入 → `[]`、不呼叫 LLM。
 */
@Injectable()
export class MediaClassifierService extends ResilientLlmBatchService {
  constructor(
    @Inject(INTENT_LABELER) private readonly labeler: IntentLabeler,
    @Inject(MEDIA_CLASSIFIER_CONFIG) config: LlmBatchConfig,
  ) {
    super(config);
  }

  /** 韌性分類 references 的媒體類別，回最終 `BlockMedia[]`（每 reference 恰一列、依輸入順序）。 */
  async classifyMedia(refs: MediaReference[]): Promise<BlockMedia[]> {
    return (await this.classifyMediaOutcome(refs)).results;
  }

  /**
   * 同 {@link classifyMedia}，但**保留** `needsReview`（降級 fallback 的輸入 reference）——供 T15.5 job-level
   * partial 收斂（AC-42.5/INV-6）。`classifyMedia` 委派此方法後 drop `needsReview`（維持既有公開契約）。
   */
  async classifyMediaOutcome(
    refs: MediaReference[],
  ): Promise<AnalysisLineOutcome<BlockMedia, MediaReference>> {
    const { collected, needsReview } = await this.runBatches<MediaResultItem, MediaReference>(
      refs,
      (chunk) => this.callBatch(chunk),
    );
    return { results: postProcessMedia(refs, { references: collected }), needsReview };
  }

  /**
   * 單批 LLM 呼叫（固定 strict `media_classification` schema、temperature=0、max tokens）。**注意**：
   * `url-media-classifier` schema 忠實沿用來源的 `{ references: [...] }` 陣列鍵（T15.1），而共用 `resilientChunk`
   * 骨架以 `{ results: [...] }` 為約定——故在此把 `references` 轉接為 `results`（refusal/malformed 時 `parsed=null`
   * 原樣透傳，交由骨架 fallback + 覆核）。
   */
  private async callBatch(
    chunk: MediaReference[],
  ): Promise<ParseChatResult<{ results: MediaResultItem[] }>> {
    const responseFormat = mediaClassifierResponseFormat();
    const raw = await this.labeler.parseChat<MediaClassifierResult>({
      messages: buildMediaClassifierMessages(chunk),
      jsonSchema: {
        name: responseFormat.json_schema.name,
        schema: responseFormat.json_schema.schema as Record<string, unknown>,
      },
      temperature: 0,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
    });
    return {
      parsed: raw.parsed ? { results: raw.parsed.references } : null,
      refusal: raw.refusal,
    };
  }
}
