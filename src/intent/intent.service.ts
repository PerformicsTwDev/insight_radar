import { AsyncResource } from 'node:async_hooks';
import { Inject, Injectable, Optional } from '@nestjs/common';
import pLimit from 'p-limit';
import { sanitizePositiveInt } from '../common/sanitize-positive-int';
import { IntentCache } from './intent-cache';
import { INTENT_LABELER, type IntentLabeler, type ParseChatResult } from './intent-labeler.port';
import { type ChunkOutcome as ResilientChunkOutcome, resilientChunk } from './resilient-batch';
import { type IntentBatch, intentResponseFormat } from './intent.schema';
import { buildIntentMessages } from './intent.prompt';
import { type LabeledKeyword, postProcessIntent } from './intent-postprocess';

/** 上限 completion tokens（避免 `finish_reason=length` 截斷；Design §4.2 ~4000）。 */
const MAX_COMPLETION_TOKENS = 4000;
/** 預設每批關鍵字數（25–40，預設 30；Design §4.2 / config LLM_BATCH_SIZE）。 */
const DEFAULT_BATCH_SIZE = 30;
/** 預設 LLM 並發上限（4–8，預設 6；Design §14 LLM_CONCURRENCY）。 */
const DEFAULT_LLM_CONCURRENCY = 6;

export interface IntentServiceConfig {
  batchSize: number;
  /** LLM 並發上限（p-limit）；省略 → 預設 6（4–8）。 */
  llmConcurrency?: number;
}

/** `labelKeywords` 含覆核清單的結果（filter/refusal fallback 的字需人工覆核）。 */
export interface LabelResult {
  labeled: LabeledKeyword[];
  needsReview: string[];
}

/** 單批韌性貼標的原始累積（postProcess 前）；共用 skeleton 的 `R = {keyword, labels}`（T12.5 抽 resilient-batch）。 */
type ChunkOutcome = ResilientChunkOutcome<{ keyword: string; labels: string[] }>;

/** 把單一關鍵字陣列包成單批 iterable（非串流呼叫者沿用；`for await` 同時接受 sync iterable）。 */
function* singleBatch(keywords: string[]): Generator<string[]> {
  yield keywords;
}

/**
 * Intent 批次貼標 + 韌性（T2.3–T2.5，FR-4/NFR-3/NFR-4）。
 *
 * - `labelBatch`：低階——切批呼叫 LLM、回各批原始結果（T2.3）。
 * - `labelKeywords`/`labelKeywordsWithReview`：高階——韌性編排（T2.5）：
 *   `finish_reason=length`（`LengthFinishReasonError`）→ 該批**對半拆再打**，拆到 size 1 仍 length →
 *   該字 fallback；`content_filter`/refusal → 該批標 fallback `informational` 並列入覆核清單。
 *   最後一律經 `postProcessIntent`（T2.4）保證每輸入恰一列、≥1 label。
 */
@Injectable()
export class IntentService {
  private readonly batchSize: number;
  private readonly llmConcurrency: number;
  /**
   * 全域 LLM 並發限流器（M3-R2）：**一個** IntentService singleton 上的所有 `labelStream`（多 job 並發
   * 同時呼叫）共用此 limiter，故全域並發上限 = llmConcurrency，**不**隨 WORKER_CONCURRENCY 倍增。
   * 若改成 per-call（每次 labelStream 自建 limiter）→ 全域 = llmConcurrency × workerConcurrency，RPM 失控。
   */
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(
    @Inject(INTENT_LABELER) private readonly labeler: IntentLabeler,
    @Inject('INTENT_SERVICE_CONFIG') config: IntentServiceConfig,
    // intent 快取（T4.2）為 @Optional：未提供（多數單元測試）→ 退回「無快取」（一律送 LLM，行為不變）。
    @Optional() private readonly intentCache?: IntentCache,
  ) {
    // floor 後須 ≥1，否則迴圈 i += 0 會無限迴圈（分數 batchSize 如 0.5 會 floor 成 0）。
    this.batchSize = sanitizePositiveInt(config.batchSize, DEFAULT_BATCH_SIZE);
    this.llmConcurrency = sanitizePositiveInt(config.llmConcurrency, DEFAULT_LLM_CONCURRENCY);
    this.limit = pLimit(this.llmConcurrency);
  }

  /** 低階：切批呼叫 LLM，回各批原始結果（不處理 length/filter；T2.3）。 */
  async labelBatch(keywords: string[]): Promise<ParseChatResult<IntentBatch>[]> {
    const results: ParseChatResult<IntentBatch>[] = [];
    for (let i = 0; i < keywords.length; i += this.batchSize) {
      results.push(await this.callBatch(keywords.slice(i, i + this.batchSize)));
    }
    return results;
  }

  /** 高階：韌性貼標，回最終 LabeledKeyword[]（每輸入一列、≥1 label）。 */
  async labelKeywords(keywords: string[]): Promise<LabeledKeyword[]> {
    return (await this.labelKeywordsWithReview(keywords)).labeled;
  }

  /** 高階：韌性貼標 + 需人工覆核清單（content_filter/refusal fallback 的字）。 */
  async labelKeywordsWithReview(keywords: string[]): Promise<LabelResult> {
    return this.labelStream(singleBatch(keywords));
  }

  /**
   * 串流式韌性貼標（T3.7，AC-12.5；T4.2 cache-first，TC-13）：邊消費 `textBatches`（拓展段產出即進來），
   * **貼標前先 `mget` intent 快取——命中省 LLM 呼叫**，只把 cache-miss 以 `p-limit(llmConcurrency)` 並發送
   * LLM（達 batchSize 即派批，讓 expand 與 label 階段重疊），LLM 結果回寫快取。所有輸入累積後一次
   * `postProcessIntent` 保證每輸入恰一列、≥1 label。無 `intentCache`（未提供）→ 一律送 LLM（行為不變）。
   */
  async labelStream(
    textBatches: AsyncIterable<string[]> | Iterable<string[]>,
  ): Promise<LabelResult> {
    // 共用全域 limiter（M3-R2）：多 job 並發共享上限，不隨 worker concurrency 倍增。單一 FIFO 佇列＝
    // 全域 RPM cap（非 per-job 公平）；先派批者先跑，可接受（Ads ~1 QPS 涓流派批本就交錯）。
    const limit = this.limit;
    const tasks: Promise<ChunkOutcome>[] = [];
    // allInputs 為 append-only（postProcess 用）；命中直接收進 cachedCollected，miss 才進 LLM 派批佇列。
    const allInputs: string[] = [];
    const cachedCollected: { keyword: string; labels: string[] }[] = [];
    const misses: string[] = [];
    let cursor = 0; // misses 已派批位置

    const dispatchFullChunks = (): void => {
      while (misses.length - cursor >= this.batchSize) {
        const chunk = misses.slice(cursor, cursor + this.batchSize); // 立即取值（避免閉包看到位移後的 cursor）
        cursor += this.batchSize;
        // AsyncResource.bind（M7-R7）：共用 limiter 是 singleton，飽和時排隊的 task 會在**別 job 的 continuation**
        // 內被 dequeue 執行 → 其內 `JobMetricsContext.current()` 會取到錯 job。綁定**入列當下**的 async 上下文，
        // 確保 task 恆在其所屬 job 的 ALS 上下文執行，LLM externalCalls/cache 計數正確歸屬（NFR-6/TC-30）。
        tasks.push(limit(AsyncResource.bind(() => this.labelChunkAndCache(chunk))));
      }
    };

    for await (const batch of textBatches) {
      allInputs.push(...batch);
      const cached = this.intentCache ? await this.intentCache.mget(batch) : undefined;
      batch.forEach((keyword, i) => {
        const labels = cached?.[i];
        if (labels && labels.length > 0) {
          cachedCollected.push({ keyword, labels }); // 命中（非空）→ 不送 LLM
        } else {
          misses.push(keyword); // miss 或退化空標籤 → 送 LLM
        }
      });
      dispatchFullChunks(); // miss 滿一批即送 → 與後續拓展重疊
    }
    if (misses.length > cursor) {
      // 尾段殘批亦綁入列上下文（M7-R7，同 dispatchFullChunks）。
      tasks.push(limit(AsyncResource.bind(() => this.labelChunkAndCache(misses.slice(cursor)))));
    }

    const outcomes = await Promise.all(tasks);
    const collected = [...cachedCollected, ...outcomes.flatMap((o) => o.collected)];
    const needsReview = outcomes.flatMap((o) => o.needsReview);
    return { labeled: postProcessIntent(allInputs, { results: collected }), needsReview };
  }

  /**
   * 貼標單批（cache-miss）並回寫成功貼標者（needsReview fallback 為不確定、不快取）。韌性遞迴
   * （length 對半拆 / content_filter·refusal fallback）由共用 {@link resilientChunk} 承擔（T12.5 抽出、FR-4/FR-33 共用）。
   */
  private async labelChunkAndCache(chunk: string[]): Promise<ChunkOutcome> {
    const outcome = await resilientChunk<{ keyword: string; labels: string[] }>(chunk, (c) =>
      this.callBatch(c),
    );
    if (this.intentCache && outcome.collected.length > 0) {
      await this.intentCache.mset(outcome.collected);
    }
    return outcome;
  }

  /** 單批 LLM 呼叫（固定 strict schema、temperature=0、max tokens）。 */
  private callBatch(chunk: string[]): Promise<ParseChatResult<IntentBatch>> {
    const responseFormat = intentResponseFormat();
    return this.labeler.parseChat<IntentBatch>({
      messages: buildIntentMessages(chunk),
      jsonSchema: {
        name: responseFormat.json_schema.name,
        schema: responseFormat.json_schema.schema as Record<string, unknown>,
      },
      temperature: 0,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
    });
  }
}
