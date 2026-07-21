import pLimit from 'p-limit';
import { sanitizePositiveInt } from '../common/sanitize-positive-int';
import type { ParseChatResult } from '../intent/intent-labeler.port';
import { type ChunkOutcome, resilientChunk } from '../intent/resilient-batch';

/**
 * 三段 AI 回答 LLM 分析線（品牌抽取 / 情緒 / 引用媒體分類，FR-42）**共用批次 pipeline**（T15.3 ③；
 * 續整併 T15.2 抽出的 `resilientChunk<R,I>` 骨架）。把三線共通的「切批 + 全域 p-limit 並發 + 韌性遞迴
 * （length 對半拆 / content_filter·refusal fallback）+ 累積」收斂到單一基底，子類只實作各自的
 * `callBatch`（prompt/schema）與 `postProcess`（對回輸入 + 驗證邊界）。
 */

/** 上限 completion tokens（避免 `finish_reason=length` 截斷；沿用 intent/journey/brand ~4000）。 */
export const MAX_COMPLETION_TOKENS = 4000;
/** 預設每批 block/reference 數（沿用 LLM 批量慣例，預設 30）。 */
export const DEFAULT_BATCH_SIZE = 30;
/** 預設 LLM 並發上限（沿用 `LLM_CONCURRENCY`，預設 6）。 */
export const DEFAULT_LLM_CONCURRENCY = 6;

/** 共用批次設定（batch 大小 + LLM 並發上限；省略 concurrency → 預設 6）。 */
export interface LlmBatchConfig {
  batchSize: number;
  /** LLM 並發上限（p-limit）；省略 → 預設 6。 */
  llmConcurrency?: number;
}

/**
 * FR-42 三段 AI 回答分析線的韌性批次基底。子類（品牌/情緒/媒體）以 `super(config)` 設定 batch/concurrency，
 * 並以 {@link runBatches} 切批送 LLM——**單一 singleton 上所有呼叫共用同一 p-limit**（全域並發上限 =
 * llmConcurrency，不隨 worker 倍增，沿用 IntentService/BrandExtractionService 慣例）。
 */
export abstract class ResilientLlmBatchService {
  protected readonly batchSize: number;
  protected readonly llmConcurrency: number;
  /** 全域 LLM 並發限流器：singleton 上所有分析呼叫共用（全域並發上限 = llmConcurrency）。 */
  protected readonly limit: ReturnType<typeof pLimit>;

  protected constructor(config: LlmBatchConfig) {
    // floor 後須 ≥1，否則迴圈 i += 0 會無限迴圈 / 並發 0（分數 batchSize 如 0.5 會 floor 成 0）。
    this.batchSize = sanitizePositiveInt(config.batchSize, DEFAULT_BATCH_SIZE);
    this.llmConcurrency = sanitizePositiveInt(config.llmConcurrency, DEFAULT_LLM_CONCURRENCY);
    this.limit = pLimit(this.llmConcurrency);
  }

  /**
   * 以 `batchSize` 切批、共用 limiter 並發送 LLM，各批經共用 {@link resilientChunk}（length 對半拆 /
   * content_filter·refusal fallback）後累積 `collected`（成功結果）與 `needsReview`（降級待覆核輸入）。
   * 空輸入 → 空 outcome、**不呼叫 LLM**。`callBatch` 回 `{ results: R[] }`（骨架約定的陣列鍵；媒體線的
   * `references` 於其 callBatch 內轉接為 `results`）。
   */
  protected async runBatches<R, I>(
    items: readonly I[],
    callBatch: (chunk: I[]) => Promise<ParseChatResult<{ results: R[] }>>,
  ): Promise<ChunkOutcome<R, I>> {
    if (items.length === 0) {
      return { collected: [], needsReview: [] };
    }
    const tasks: Promise<ChunkOutcome<R, I>>[] = [];
    for (let i = 0; i < items.length; i += this.batchSize) {
      const chunk = items.slice(i, i + this.batchSize);
      tasks.push(this.limit(() => resilientChunk<R, I>(chunk, callBatch)));
    }
    const outcomes = await Promise.all(tasks);
    return {
      collected: outcomes.flatMap((o) => o.collected),
      needsReview: outcomes.flatMap((o) => o.needsReview),
    };
  }
}
