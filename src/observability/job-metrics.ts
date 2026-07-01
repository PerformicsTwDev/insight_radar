import { LogField, type LogPhase } from '../logger/log-fields';

/** 每 job 的計數（Design §12.2 / TC-30）。 */
export interface JobCounts {
  /** expand 階段產出的關鍵字數（exact 模式為 0）。 */
  expanded: number;
  /** 取得 intent 標籤的關鍵字數。 */
  labeled: number;
  /** 最終關鍵字總數（進 snapshot）。 */
  total: number;
}

/**
 * 每 job 的可觀測指標收集器（T7.2，NFR-6 / TC-30）。累積各 phase 耗時 + 計數，job 結束時由 processor 以
 * **結構化欄位**（{@link LogField} SSOT）一次輸出（結構化 log，可輪詢/查詢）。純資料容器、無 I/O。
 *
 * 時鐘可注入（測試用；預設 `Date.now`）。cacheHitRate / externalCalls / retries 之跨服務計數於 slice B 經
 * AsyncLocalStorage 併入。
 */
export class JobMetrics {
  private readonly phaseMs: Partial<Record<LogPhase, number>> = {};
  private counts: JobCounts = { expanded: 0, labeled: 0, total: 0 };
  private cacheHits = 0;
  private cacheLookups = 0;
  private externalCalls = 0;
  private retries = 0;

  constructor(
    private readonly analysisId: string,
    private readonly clock: () => number = Date.now,
  ) {}

  /**
   * 開始計時一個 phase，回傳**結束函式**——呼叫時記錄該 phase 的 `durationMs`（非單調時鐘夾為 0，不產生負值）。
   * 同名 phase 重複計時會覆寫（取最後一次）。
   */
  startPhase(phase: LogPhase): () => void {
    const start = this.clock();
    return () => {
      this.phaseMs[phase] = Math.max(0, this.clock() - start);
    };
  }

  /** 設定 job 計數（expanded/labeled/total）。 */
  setCounts(counts: JobCounts): void {
    this.counts = counts;
  }

  /** 累加一次快取查詢的命中/總數（跨服務、經 AsyncLocalStorage 由各 cache mget 遞增，T7.2 slice B）。 */
  recordCacheLookup(hits: number, lookups: number): void {
    this.cacheHits += hits;
    this.cacheLookups += lookups;
  }

  /** 外部 API 呼叫數 +n（Ads/LLM 每次呼叫）。 */
  addExternalCalls(n = 1): void {
    this.externalCalls += n;
  }

  /** 重試數 +n（Ads job 內退避每次重試）。 */
  addRetries(n = 1): void {
    this.retries += n;
  }

  /** cache 命中率（0..1）；無任何查詢時為 `null`（不假造 0，避免誤導）。 */
  private cacheHitRate(): number | null {
    return this.cacheLookups > 0 ? this.cacheHits / this.cacheLookups : null;
  }

  /**
   * 匯出結構化 log 欄位（NFR-6/TC-30，欄位名取 {@link LogField} SSOT）：analysisId、status、各 phase 耗時、
   * expanded/labeled/total、cacheHitRate、externalCalls、retries。
   */
  toLogFields(status: string): Record<string, unknown> {
    return {
      [LogField.ANALYSIS_ID]: this.analysisId,
      [LogField.STATUS]: status,
      [LogField.PHASES]: { ...this.phaseMs },
      [LogField.EXPANDED]: this.counts.expanded,
      [LogField.LABELED]: this.counts.labeled,
      [LogField.TOTAL]: this.counts.total,
      [LogField.CACHE_HIT_RATE]: this.cacheHitRate(),
      [LogField.EXTERNAL_CALLS]: this.externalCalls,
      [LogField.RETRIES]: this.retries,
    };
  }
}
