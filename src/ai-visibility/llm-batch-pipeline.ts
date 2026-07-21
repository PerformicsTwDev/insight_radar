/**
 * 三段 AI 回答 LLM 分析線（品牌抽取 / 情緒 / 引用媒體分類，FR-42）**共用批次 pipeline** 的設定形狀。
 * RED 空殼（T15.3）：此檔於 green 追加 `ResilientLlmBatchService` 抽象基底（切批 + 全域 p-limit 並發 +
 * 共用 `resilientChunk` 韌性遞迴），三段服務共同繼承——續整併 T15.2 抽出的骨架。
 */

/** 共用批次設定（batch 大小 + LLM 並發上限；省略 concurrency → 預設）。 */
export interface LlmBatchConfig {
  batchSize: number;
  /** LLM 並發上限（p-limit）；省略 → 預設 6。 */
  llmConcurrency?: number;
}
