import { LogField } from '../logger/log-fields';
import type { TopicPhase } from './topic-run.types';

/** 分群 job 各階段的參考延遲預算（ms；NFR-11 觀測基準，非硬性強制——超出僅供結構化 log 對照/告警）。 */
export const TOPIC_LATENCY_BUDGET_MS: Record<TopicPhase, number> = {
  load: 2_000,
  serp: 60_000,
  embed: 120_000,
  cluster: 90_000,
  represent: 2_000,
  name: 60_000,
  persist: 5_000,
};

/** 分群 job 計數（進結構化 log）。 */
export interface TopicJobCounts {
  keywordCount: number;
  clusterCount: number;
  noiseCount: number;
}

/**
 * 分群 job 的可觀測指標收集器（T8.12，NFR-11/NFR-6；平行於 keyword-analysis 的 {@link JobMetrics}）。累積各階段
 * 耗時 + 群/noise/關鍵字計數 + 降級旗標，job 結束由 processor 以**結構化欄位**（{@link LogField} SSOT）一次輸出。
 * **純資料容器、無 I/O**；時鐘可注入（測試確定性，預設 `Date.now`）。
 */
export class TopicJobMetrics {
  private readonly phaseMs: Partial<Record<TopicPhase, number>> = {};
  private counts: TopicJobCounts = { keywordCount: 0, clusterCount: 0, noiseCount: 0 };
  private degraded = false;

  constructor(
    private readonly runId: string,
    private readonly clock: () => number = Date.now,
  ) {}

  /**
   * 開始計時一個階段，回**結束函式**——呼叫時記錄該階段 `durationMs`（非單調時鐘夾為 0，不產負值）。
   * 同名階段重複計時取最後一次。
   */
  startPhase(phase: TopicPhase): () => void {
    const start = this.clock();
    return () => {
      this.phaseMs[phase] = Math.max(0, this.clock() - start);
    };
  }

  /** 設定計數（關鍵字/群/noise 數）。 */
  setCounts(counts: TopicJobCounts): void {
    this.counts = counts;
  }

  /** 標記是否曾降級（SERP 退純文字 / 命名 fallback）。 */
  setDegraded(degraded: boolean): void {
    this.degraded = degraded;
  }

  /**
   * 匯出結構化 log 欄位（NFR-6/NFR-11）：topicJobId、status、各階段耗時、keyword/cluster/noise 計數、degraded。
   */
  toLogFields(status: string): Record<string, unknown> {
    return {
      [LogField.TOPIC_JOB_ID]: this.runId,
      [LogField.STATUS]: status,
      [LogField.PHASES]: { ...this.phaseMs },
      [LogField.KEYWORD_COUNT]: this.counts.keywordCount,
      [LogField.CLUSTER_COUNT]: this.counts.clusterCount,
      [LogField.NOISE_COUNT]: this.counts.noiseCount,
      [LogField.DEGRADED]: this.degraded,
    };
  }
}
