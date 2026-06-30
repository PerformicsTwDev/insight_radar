import { Inject, Injectable } from '@nestjs/common';
import {
  BadRequestError,
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from 'openai/core/error';
import pLimit from 'p-limit';
import { INTENT_LABELER, type IntentLabeler, type ParseChatResult } from './intent-labeler.port';
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

/** 單批韌性貼標的原始累積（postProcess 前）。 */
interface ChunkOutcome {
  collected: { keyword: string; labels: string[] }[];
  needsReview: string[];
}

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

  constructor(
    @Inject(INTENT_LABELER) private readonly labeler: IntentLabeler,
    @Inject('INTENT_SERVICE_CONFIG') config: IntentServiceConfig,
  ) {
    // floor 後須 ≥1，否則迴圈 i += 0 會無限迴圈（分數 batchSize 如 0.5 會 floor 成 0）。
    this.batchSize = sanitizePositiveInt(config.batchSize, DEFAULT_BATCH_SIZE);
    this.llmConcurrency = sanitizePositiveInt(config.llmConcurrency, DEFAULT_LLM_CONCURRENCY);
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
   * 串流式韌性貼標（T3.7，AC-12.5）：邊消費 `textBatches`（拓展段產出即進來）邊以
   * `p-limit(llmConcurrency)` 並發送 LLM——達 batchSize 即派批，讓 **expand 與 label 階段重疊**且
   * LLM 並發受控（與 WORKER_CONCURRENCY、Ads 限流器為三個獨立維度）。所有輸入累積後一次
   * `postProcessIntent` 保證每輸入恰一列、≥1 label。
   */
  async labelStream(
    textBatches: AsyncIterable<string[]> | Iterable<string[]>,
  ): Promise<LabelResult> {
    const limit = pLimit(this.llmConcurrency);
    const tasks: Promise<ChunkOutcome>[] = [];
    const allInputs: string[] = [];
    let buffer: string[] = [];

    const dispatchFullChunks = (): void => {
      while (buffer.length >= this.batchSize) {
        const chunk = buffer.slice(0, this.batchSize);
        buffer = buffer.slice(this.batchSize);
        tasks.push(limit(() => this.labelChunkResilient(chunk)));
      }
    };

    for await (const batch of textBatches) {
      allInputs.push(...batch);
      buffer.push(...batch);
      dispatchFullChunks(); // 滿一批即送 → 與後續拓展重疊
    }
    if (buffer.length > 0) {
      tasks.push(limit(() => this.labelChunkResilient(buffer)));
    }

    const outcomes = await Promise.all(tasks);
    const collected = outcomes.flatMap((o) => o.collected);
    const needsReview = outcomes.flatMap((o) => o.needsReview);
    return { labeled: postProcessIntent(allInputs, { results: collected }), needsReview };
  }

  /**
   * 對單批做韌性呼叫並**回傳**累積結果：length → 對半遞迴（序列、不超 p-limit 並發）；
   * content_filter/refusal/malformed → 整批 fallback + 覆核（postProcess 補 informational）。
   */
  private async labelChunkResilient(chunk: string[]): Promise<ChunkOutcome> {
    // chunk 永遠非空：外層只送非空批，遞迴只在 length ≥2 時對半（兩半皆非空）。
    try {
      const result = await this.callBatch(chunk);
      // refusal 或 malformed（strict 為 server-only 保證，client 端不驗；缺 results 仍可能）→
      // 整批 fallback（postProcess 補 informational）+ 覆核；不得 spread undefined 而崩（M2-R2）。
      if (result.refusal !== null || !Array.isArray(result.parsed?.results)) {
        return { collected: [], needsReview: [...chunk] };
      }
      return { collected: result.parsed.results, needsReview: [] };
    } catch (error) {
      if (error instanceof LengthFinishReasonError) {
        if (chunk.length === 1) {
          return { collected: [], needsReview: [] }; // 拆到底仍 length → postProcess 補 fallback。
        }
        const mid = Math.ceil(chunk.length / 2);
        const left = await this.labelChunkResilient(chunk.slice(0, mid));
        const right = await this.labelChunkResilient(chunk.slice(mid));
        return {
          collected: [...left.collected, ...right.collected],
          needsReview: [...left.needsReview, ...right.needsReview],
        };
      }
      if (
        error instanceof ContentFilterFinishReasonError ||
        (error instanceof BadRequestError && error.code === 'content_filter')
      ) {
        // completion-side（200 finish_reason）或 prompt-side（HTTP 400 code=content_filter）內容過濾
        // → 整批 fallback + 覆核（M2-R1：prompt-side 400 原會落到下方 throw 使整 job 崩）。
        return { collected: [], needsReview: [...chunk] };
      }
      throw error; // 其餘錯誤（429/5xx 已由 SDK maxRetries 處理；非預期/非 content_filter 400 則上拋）。
    }
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

/** floor 後須為有限正整數，否則回退預設（防 0 致無限迴圈 / 並發 0）。 */
function sanitizePositiveInt(value: number | undefined, fallback: number): number {
  const floored = Math.floor(value ?? fallback);
  return Number.isFinite(floored) && floored >= 1 ? floored : fallback;
}
