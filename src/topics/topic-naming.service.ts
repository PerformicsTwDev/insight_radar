import { AsyncResource } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import {
  BadRequestError,
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from 'openai/core/error';
import pLimit from 'p-limit';
import { sanitizePositiveInt } from '../common/sanitize-positive-int';
import { AzureOpenAiService } from '../intent/azure-openai.service';
import type { IntentLabeler, ParseChatResult } from '../intent/intent-labeler.port';
import {
  type ClusterNaming,
  type RawTopicNaming,
  reconcileClusterNamings,
} from './topic-naming.postprocess';
import { buildTopicNamingMessages, type ClusterToName } from './topic-naming.prompt';
import { topicNamingResponseFormat } from './topic-naming.schema';

/** 上限 completion tokens（避免 `finish_reason=length` 截斷；同 intent，Design §4.2）。 */
const MAX_COMPLETION_TOKENS = 4000;
/** 預設每批群數（Design §14 TOPIC_LLM_BATCH_CLUSTERS）。 */
const DEFAULT_BATCH_CLUSTERS = 20;
/** 預設 LLM 並發上限（複用 LLM_CONCURRENCY）。 */
const DEFAULT_LLM_CONCURRENCY = 6;

/** DI token：`{ batchClusters, llmConcurrency }`（由 topics + azure config 組裝）。 */
export const TOPIC_NAMING_CONFIG = Symbol('TOPIC_NAMING_CONFIG');

export interface TopicNamingConfig {
  /** 每批送 LLM 的群數（TOPIC_LLM_BATCH_CLUSTERS）。 */
  batchClusters: number;
  /** LLM 並發上限（p-limit）；省略 → 預設 6。 */
  llmConcurrency?: number;
}

/**
 * 群命名服務（T8.7，FR-18 / TC-44；Design §16.3 name）。**複用 `AzureOpenAiService`**（`INTENT_LABELER`
 * 低階 `parseChat`），送固定 strict `json_schema`（temperature=0）批數群命名。
 *
 * - 批 `batchClusters` 群、`p-limit(llmConcurrency)` 並發（`AsyncResource.bind` 保 job 上下文正確歸屬，M7-R7）。
 * - 韌性：`finish_reason=length` → 該批對半拆再打（拆到 1 仍 length → 該群 fallback）；`content_filter`
 *   （completion 或 prompt-side 400）/refusal/malformed/**數量不符** → 安全 fallback（`degraded=true`）。
 * - **群層 intent 與 FR-4 每字 intentLabels 分表互補、不覆寫**（此服務只回群命名，不動 keyword_intents）。
 * - 回傳每群恰一列、對齊輸入順序。降級以 `degraded` 旗標回報，由 T8.9 決定是否標 job partial（NFR-12）。
 */
@Injectable()
export class TopicNamingService {
  private readonly batchClusters: number;
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(
    @Inject(AzureOpenAiService) private readonly labeler: IntentLabeler,
    @Inject(TOPIC_NAMING_CONFIG) config: TopicNamingConfig,
  ) {
    this.batchClusters = sanitizePositiveInt(config.batchClusters, DEFAULT_BATCH_CLUSTERS);
    this.limit = pLimit(sanitizePositiveInt(config.llmConcurrency, DEFAULT_LLM_CONCURRENCY));
  }

  /** 命名一批群：切批 → 並發韌性呼叫 → 依輸入順序串接。每群恰一列（含 fallback）。 */
  async nameClusters(clusters: ClusterToName[]): Promise<ClusterNaming[]> {
    if (clusters.length === 0) {
      return [];
    }
    const batches: ClusterToName[][] = [];
    for (let i = 0; i < clusters.length; i += this.batchClusters) {
      batches.push(clusters.slice(i, i + this.batchClusters));
    }
    const results = await Promise.all(
      batches.map((batch) => this.limit(AsyncResource.bind(() => this.nameBatchResilient(batch)))),
    );
    return results.flat();
  }

  /**
   * 對單批做韌性呼叫：length → 對半遞迴（序列、不超 p-limit 並發）；content_filter/refusal/malformed →
   * 整批 fallback。批永遠非空（外層只切非空、遞迴只在 ≥2 對半）。
   */
  private async nameBatchResilient(batch: ClusterToName[]): Promise<ClusterNaming[]> {
    try {
      const result = await this.callBatch(batch);
      if (result.refusal !== null) {
        return reconcileClusterNamings(batch, null, 'refusal');
      }
      return reconcileClusterNamings(batch, result.parsed, 'malformed');
    } catch (error) {
      if (error instanceof LengthFinishReasonError) {
        if (batch.length === 1) {
          return reconcileClusterNamings(batch, null, 'length');
        }
        const mid = Math.ceil(batch.length / 2);
        const left = await this.nameBatchResilient(batch.slice(0, mid));
        const right = await this.nameBatchResilient(batch.slice(mid));
        return [...left, ...right];
      }
      if (
        error instanceof ContentFilterFinishReasonError ||
        (error instanceof BadRequestError && error.code === 'content_filter')
      ) {
        // completion-side（200 finish_reason）或 prompt-side（HTTP 400 code=content_filter）內容過濾。
        return reconcileClusterNamings(batch, null, 'content_filter');
      }
      throw error; // 其餘（429/5xx 已由 SDK maxRetries 處理；非預期錯上拋）。
    }
  }

  /** 單批 LLM 呼叫（固定 strict schema、temperature=0、max tokens）。 */
  private callBatch(batch: ClusterToName[]): Promise<ParseChatResult<RawTopicNaming>> {
    const responseFormat = topicNamingResponseFormat();
    return this.labeler.parseChat<RawTopicNaming>({
      messages: buildTopicNamingMessages(batch),
      jsonSchema: {
        name: responseFormat.json_schema.name,
        schema: responseFormat.json_schema.schema as Record<string, unknown>,
      },
      temperature: 0,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
    });
  }
}
