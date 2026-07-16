import { Inject, Injectable, Optional } from '@nestjs/common';
import pLimit from 'p-limit';
import { INTENT_LABELER, type IntentLabeler } from '../intent/intent-labeler.port';
import { JourneyCache } from './journey-cache';
import { type StagedKeyword } from './journey-postprocess';

/** 預設每批關鍵字數（沿用 intent 批量慣例，預設 30；config `JOURNEY_LLM_BATCH_SIZE`）。 */
const DEFAULT_BATCH_SIZE = 30;
/** 預設 LLM 並發上限（沿用 `LLM_CONCURRENCY`，預設 6）。 */
const DEFAULT_LLM_CONCURRENCY = 6;

/** DI token for JourneyService 設定（batch/concurrency；由 module 從 config 組裝）。 */
export const JOURNEY_SERVICE_CONFIG = Symbol('JOURNEY_SERVICE_CONFIG');

export interface JourneyServiceConfig {
  batchSize: number;
  /** LLM 並發上限（p-limit）；省略 → 預設 6。 */
  llmConcurrency?: number;
}

/**
 * 購買歷程分類 pipeline（T12.5，FR-33 / AC-33.1~33.3/33.5，TC-69 部分）。
 *
 * `classify(keywords)`：cache-first（`JourneyCache.mget`，命中省 LLM）→ 只對 miss 以批次 + `resilientChunk`
 * （length 對半拆 / content_filter·refusal fallback，複用 intent 骨架）並發送 LLM → 回寫快取 →
 * `postProcessJourney` 保證**每輸入恰一列**、single-label、缺漏補 `need_definition`。snapshot-scoped 持久化
 * （`keyword_journey_assignments`，AC-33.5）由 {@link JourneyRepository} 另行負責、**不覆寫** `keyword_intents`。
 */
@Injectable()
export class JourneyService {
  private readonly batchSize: number;
  private readonly llmConcurrency: number;
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(
    @Inject(INTENT_LABELER) private readonly labeler: IntentLabeler,
    @Inject(JOURNEY_SERVICE_CONFIG) config: JourneyServiceConfig,
    // journey 快取（AC-33.3）為 @Optional：未提供（多數單元測試）→ 退回「無快取」（一律送 LLM，行為不變）。
    @Optional() private readonly cache?: JourneyCache,
  ) {
    this.batchSize = sanitizePositiveInt(config.batchSize, DEFAULT_BATCH_SIZE);
    this.llmConcurrency = sanitizePositiveInt(config.llmConcurrency, DEFAULT_LLM_CONCURRENCY);
    this.limit = pLimit(this.llmConcurrency);
  }

  /**
   * 韌性分類 keywords，回最終 `StagedKeyword[]`（每輸入恰一 stage、依輸入順序）。cache-first：命中省 LLM。
   */
  classify(_keywords: string[]): Promise<StagedKeyword[]> {
    return Promise.reject(new Error('not implemented'));
  }
}

/** floor 後須為有限正整數，否則回退預設（防 0 致無限迴圈 / 並發 0）。 */
function sanitizePositiveInt(value: number | undefined, fallback: number): number {
  const floored = Math.floor(value ?? fallback);
  return Number.isFinite(floored) && floored >= 1 ? floored : fallback;
}
