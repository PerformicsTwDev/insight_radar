import { Inject, Injectable, Optional } from '@nestjs/common';
import pLimit from 'p-limit';
import {
  INTENT_LABELER,
  type IntentLabeler,
  type ParseChatResult,
} from '../intent/intent-labeler.port';
import { type ChunkOutcome, resilientChunk } from '../intent/resilient-batch';
import type { CustomLabel } from './custom-classify.schema';
import { CustomClassifyAssignCache } from './custom-classify-assign-cache';
import { computeLabelsHash } from './custom-classify-idempotency';
import {
  type AssignedKeyword,
  postProcessCustomAssign,
} from './custom-classify-assign-postprocess';
import { buildCustomAssignMessages } from './custom-classify-assign.prompt';
import {
  type CustomAssignBatch,
  type CustomAssignResult,
  buildCustomAssignResponseFormat,
} from './custom-classify-assign.schema';

/** 上限 completion tokens（避免 `finish_reason=length` 截斷；沿用 intent/journey ~4000）。 */
const MAX_COMPLETION_TOKENS = 4000;
/** 預設每批關鍵字數（沿用批量慣例，預設 30；config `CUSTOM_CLASSIFY_LLM_BATCH_SIZE`）。 */
const DEFAULT_BATCH_SIZE = 30;
/** 預設 LLM 並發上限（沿用 `LLM_CONCURRENCY`，預設 6）。 */
const DEFAULT_LLM_CONCURRENCY = 6;

/** DI token for CustomClassifyAssignService 設定（batch/concurrency；由 module 從 config 組裝）。 */
export const CUSTOM_CLASSIFY_ASSIGN_CONFIG = Symbol('CUSTOM_CLASSIFY_ASSIGN_CONFIG');

export interface CustomClassifyAssignConfig {
  batchSize: number;
  /** LLM 並發上限（p-limit）；省略 → 預設 6。 */
  llmConcurrency?: number;
}

/**
 * 自訂分類階段二歸類 pipeline（T12.8，FR-34 / AC-34.2，TC-70 部分）。**與 journey（FR-33）同構**。
 *
 * `classifyByLabels(cid, labels, keywords)`：cache-first（`CustomClassifyAssignCache.mget`，per-(cid, nt)、以確認
 * 標籤集驗成員，命中省 LLM）→ 只對 miss 以批次 + `resilientChunk`（length 對半拆 / content_filter·refusal
 * fallback，**複用 intent 骨架**）並發送 LLM（**動態 enum** schema 由確認標籤即時建）→ 回寫快取 →
 * `postProcessCustomAssign` 保證**每輸入恰一列**、single-label、非確認集/缺漏補 sentinel `unclassified`（S11）。
 * snapshot-scoped 持久化（`keyword_custom_assignments`）由 repository 另負責、**不覆寫** `keyword_intents`（S10）。
 */
@Injectable()
export class CustomClassifyAssignService {
  private readonly batchSize: number;
  private readonly llmConcurrency: number;
  /** 全域 LLM 並發限流器：singleton 上所有 classify 共用（全域並發上限 = llmConcurrency、不隨 worker 倍增）。 */
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(
    @Inject(INTENT_LABELER) private readonly labeler: IntentLabeler,
    @Inject(CUSTOM_CLASSIFY_ASSIGN_CONFIG) config: CustomClassifyAssignConfig,
    // 快取為 @Optional：未提供（多數單元測試）→ 退回「無快取」（一律送 LLM，行為不變）。
    @Optional() private readonly cache?: CustomClassifyAssignCache,
  ) {
    this.batchSize = sanitizePositiveInt(config.batchSize, DEFAULT_BATCH_SIZE);
    this.llmConcurrency = sanitizePositiveInt(config.llmConcurrency, DEFAULT_LLM_CONCURRENCY);
    this.limit = pLimit(this.llmConcurrency);
  }

  /**
   * 韌性歸類 keywords 至確認標籤，回最終 `AssignedKeyword[]`（每輸入恰一 label、依輸入順序）。cache-first：命中省 LLM。
   */
  async classifyByLabels(
    classificationId: string,
    labels: CustomLabel[],
    keywords: string[],
  ): Promise<AssignedKeyword[]> {
    if (keywords.length === 0) {
      return [];
    }
    const labelStrings = labels.map((l) => l.label);
    const allowed = new Set(labelStrings);
    // labelsHash（含 label + description）入快取 key → HITL 任何改動自然隔離（coherency，reviewer #490）。
    const labelsHash = computeLabelsHash(labels);

    // cache-first：命中（在確認集內的 label）直接收；miss 才送 LLM。無 cache → 全 miss。
    const cached = this.cache
      ? await this.cache.mget(classificationId, labelsHash, keywords, allowed)
      : undefined;
    const cachedCollected: CustomAssignResult[] = [];
    const misses: string[] = [];
    keywords.forEach((keyword, i) => {
      const label = cached?.[i];
      if (label) {
        cachedCollected.push({ keyword, label });
      } else {
        misses.push(keyword);
      }
    });

    // 只對 miss 以 batchSize 切批、共用 limiter 並發送 LLM（達批即派、全域 RPM 受控）。
    const tasks: Promise<ChunkOutcome<CustomAssignResult>>[] = [];
    for (let i = 0; i < misses.length; i += this.batchSize) {
      const chunk = misses.slice(i, i + this.batchSize);
      tasks.push(
        this.limit(() =>
          this.classifyChunkAndCache(classificationId, labelsHash, labels, allowed, chunk),
        ),
      );
    }
    const outcomes = await Promise.all(tasks);

    const collected = [...cachedCollected, ...outcomes.flatMap((o) => o.collected)];
    return postProcessCustomAssign(keywords, { results: collected }, labelStrings);
  }

  /** 分類單批（cache-miss）並回寫成功者（fallback/非確認集不快取——由 cache.mset 驗成員濾除）。 */
  private async classifyChunkAndCache(
    classificationId: string,
    labelsHash: string,
    labels: CustomLabel[],
    allowed: ReadonlySet<string>,
    chunk: string[],
  ): Promise<ChunkOutcome<CustomAssignResult>> {
    const outcome = await resilientChunk<CustomAssignResult>(chunk, (c) =>
      this.callBatch(labels, c),
    );
    if (this.cache && outcome.collected.length > 0) {
      await this.cache.mset(classificationId, labelsHash, outcome.collected, allowed);
    }
    return outcome;
  }

  /** 單批 LLM 呼叫（**動態** enum schema、temperature=0、max tokens）。 */
  private callBatch(
    labels: CustomLabel[],
    chunk: string[],
  ): Promise<ParseChatResult<CustomAssignBatch>> {
    const responseFormat = buildCustomAssignResponseFormat(labels.map((l) => l.label));
    return this.labeler.parseChat<CustomAssignBatch>({
      messages: buildCustomAssignMessages(labels, chunk),
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
