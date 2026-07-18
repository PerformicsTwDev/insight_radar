import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import pLimit from 'p-limit';
import {
  INTENT_LABELER,
  type IntentLabeler,
  type ParseChatResult,
} from '../intent/intent-labeler.port';
import { sanitizePositiveInt } from '../common/sanitize-positive-int';
import { type ChunkOutcome, resilientChunk } from '../intent/resilient-batch';
import { JourneyCache } from './journey-cache';
import { postProcessJourney, type StagedKeyword } from './journey-postprocess';
import { buildJourneyMessages } from './journey.prompt';
import { type JourneyBatch, type JourneyStage, journeyResponseFormat } from './journey.schema';

/** 上限 completion tokens（避免 `finish_reason=length` 截斷；沿用 intent ~4000）。 */
const MAX_COMPLETION_TOKENS = 4000;
/** 預設每批關鍵字數（沿用 intent 批量慣例，預設 30；config `JOURNEY_LLM_BATCH_SIZE`）。 */
const DEFAULT_BATCH_SIZE = 30;
/** 預設 LLM 並發上限（沿用 `LLM_CONCURRENCY`，預設 6）。 */
const DEFAULT_LLM_CONCURRENCY = 6;

/** LLM 單筆分類結果（resilientChunk 的 `R`）。 */
type JourneyResult = { keyword: string; stage: JourneyStage };

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
 * （length 對半拆 / content_filter·refusal fallback，**複用 intent 骨架**）並發送 LLM → 回寫快取 →
 * `postProcessJourney` 保證**每輸入恰一列**、single-label、缺漏補 `need_definition`。snapshot-scoped 持久化
 * （`keyword_journey_assignments`，AC-33.5）由 {@link JourneyRepository} 另行負責、**不覆寫** `keyword_intents`。
 */
@Injectable()
export class JourneyService {
  private readonly logger = new Logger(JourneyService.name);
  private readonly batchSize: number;
  private readonly llmConcurrency: number;
  /**
   * 全域 LLM 並發限流器：一個 JourneyService singleton 上的所有 classify 共用此 limiter，全域並發上限 =
   * llmConcurrency（不隨 worker 倍增）。T12.6（job + JobMetricsContext）若加入計數歸屬，需比照 intent M7-R7
   * 以 `AsyncResource.bind` 綁入列上下文；T12.5 無 metrics，故此處不綁。
   */
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
  async classify(keywords: string[]): Promise<StagedKeyword[]> {
    if (keywords.length === 0) {
      return [];
    }
    // cache-first：命中（非空 stage）直接收進 cachedCollected；miss 才送 LLM。無 cache（未提供）→ 全 miss。
    const cached = this.cache ? await this.cache.mget(keywords) : undefined;
    const cachedCollected: JourneyResult[] = [];
    const misses: string[] = [];
    keywords.forEach((keyword, i) => {
      const stage = cached?.[i];
      if (stage) {
        cachedCollected.push({ keyword, stage });
      } else {
        misses.push(keyword);
      }
    });

    // 只對 miss 以 batchSize 切批、共用 limiter 並發送 LLM（達批即派、全域 RPM 受控）。
    const tasks: Promise<ChunkOutcome<JourneyResult>>[] = [];
    for (let i = 0; i < misses.length; i += this.batchSize) {
      const chunk = misses.slice(i, i + this.batchSize);
      tasks.push(this.limit(() => this.classifyChunkAndCache(chunk)));
    }
    const outcomes = await Promise.all(tasks);

    // 觀測性（M12-#484）：被降級（refusal / content_filter / 拆到底仍 malformed）的關鍵字會靜默補
    // `need_definition`；記其數量供監控（不外洩多筆內容，只採樣少量第一方關鍵字文字輔助排查）。
    const needsReview = outcomes.flatMap((o) => o.needsReview);
    if (needsReview.length > 0) {
      const sample = needsReview.slice(0, 5).join(', ');
      this.logger.warn(
        `journey classify: ${needsReview.length}/${keywords.length} keyword(s) fell back to ` +
          `need_definition (refusal/content_filter/malformed); sample: ${sample}`,
      );
    }

    const collected = [...cachedCollected, ...outcomes.flatMap((o) => o.collected)];
    return postProcessJourney(keywords, { results: collected });
  }

  /** 分類單批（cache-miss）並回寫成功者（needsReview fallback 為不確定、不快取）。 */
  private async classifyChunkAndCache(chunk: string[]): Promise<ChunkOutcome<JourneyResult>> {
    const outcome = await resilientChunk<JourneyResult>(chunk, (c) => this.callBatch(c));
    if (this.cache && outcome.collected.length > 0) {
      await this.cache.mset(outcome.collected);
    }
    return outcome;
  }

  /** 單批 LLM 呼叫（固定 strict schema、temperature=0、max tokens）。 */
  private callBatch(chunk: string[]): Promise<ParseChatResult<JourneyBatch>> {
    const responseFormat = journeyResponseFormat();
    return this.labeler.parseChat<JourneyBatch>({
      messages: buildJourneyMessages(chunk),
      jsonSchema: {
        name: responseFormat.json_schema.name,
        schema: responseFormat.json_schema.schema as Record<string, unknown>,
      },
      temperature: 0,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
    });
  }
}
