import { Inject, Injectable } from '@nestjs/common';
import { ContentFilterFinishReasonError, LengthFinishReasonError } from 'openai/core/error';
import { INTENT_LABELER, type IntentLabeler, type ParseChatResult } from './intent-labeler.port';
import { type IntentBatch, intentResponseFormat } from './intent.schema';
import { buildIntentMessages } from './intent.prompt';
import { type LabeledKeyword, postProcessIntent } from './intent-postprocess';

/** 上限 completion tokens（避免 `finish_reason=length` 截斷；Design §4.2 ~4000）。 */
const MAX_COMPLETION_TOKENS = 4000;
/** 預設每批關鍵字數（25–40，預設 30；Design §4.2 / config LLM_BATCH_SIZE）。 */
const DEFAULT_BATCH_SIZE = 30;

export interface IntentServiceConfig {
  batchSize: number;
}

/** `labelKeywords` 含覆核清單的結果（filter/refusal fallback 的字需人工覆核）。 */
export interface LabelResult {
  labeled: LabeledKeyword[];
  needsReview: string[];
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

  constructor(
    @Inject(INTENT_LABELER) private readonly labeler: IntentLabeler,
    @Inject('INTENT_SERVICE_CONFIG') config: IntentServiceConfig,
  ) {
    // floor 後須 ≥1，否則迴圈 i += 0 會無限迴圈（分數 batchSize 如 0.5 會 floor 成 0）。
    const floored = Math.floor(config.batchSize);
    this.batchSize = Number.isFinite(floored) && floored >= 1 ? floored : DEFAULT_BATCH_SIZE;
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
    const collected: { keyword: string; labels: string[] }[] = [];
    const needsReview: string[] = [];

    for (let i = 0; i < keywords.length; i += this.batchSize) {
      const chunk = keywords.slice(i, i + this.batchSize);
      await this.labelChunkResilient(chunk, collected, needsReview);
    }

    return { labeled: postProcessIntent(keywords, { results: collected }), needsReview };
  }

  /**
   * 對單批做韌性呼叫：length → 對半遞迴；content_filter/refusal → 整批 fallback + 覆核。
   * 結果累積進 `collected`（postProcess 會對回輸入並補 fallback；length 拆到底也由 postProcess 補）。
   */
  private async labelChunkResilient(
    chunk: string[],
    collected: { keyword: string; labels: string[] }[],
    needsReview: string[],
  ): Promise<void> {
    // chunk 永遠非空：外層 slice 不產空批，遞迴只在 length ≥2 時對半（兩半皆非空）。
    try {
      const result = await this.callBatch(chunk);
      if (result.refusal !== null || result.parsed === null) {
        // refusal → 整批 fallback（postProcess 補 informational）+ 覆核。
        needsReview.push(...chunk);
        return;
      }
      collected.push(...result.parsed.results);
    } catch (error) {
      if (error instanceof LengthFinishReasonError) {
        if (chunk.length === 1) {
          return; // 拆到底仍 length → 留空，postProcess 補 fallback。
        }
        const mid = Math.ceil(chunk.length / 2);
        await this.labelChunkResilient(chunk.slice(0, mid), collected, needsReview);
        await this.labelChunkResilient(chunk.slice(mid), collected, needsReview);
        return;
      }
      if (error instanceof ContentFilterFinishReasonError) {
        needsReview.push(...chunk); // 整批 fallback + 覆核。
        return;
      }
      throw error; // 其餘錯誤（429/5xx 已由 SDK maxRetries 處理；非預期則上拋）。
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
