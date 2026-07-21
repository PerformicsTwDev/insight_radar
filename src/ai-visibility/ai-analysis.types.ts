/**
 * M15 AI 分析 job 編排（T15.5，FR-42/AC-42.5）的共用型別。三線 AI 回答分析（品牌/情緒/媒體，T15.2/T15.3）
 * 的線輸出擴充為「per-input 後處理列 + 降級輸入項（needsReview）」——**job-level partial 收斂點**（T15.3 服務的
 * 公開方法僅回 per-input 列、drop 掉 per-item needsReview，此處由 `*Outcome` 姊妹方法重新暴露，供 orchestration
 * 收斂為 job-level partial，AC-42.5/INV-6）。
 */

/**
 * 單一分析線的輸出：`results`=每個輸入恰一列（缺漏/降級由各 postProcess 補預設，**不污染他筆**）；
 * `needsReview`=LLM 降級 fallback（content_filter/refusal/malformed/length 拆到底）的輸入項——**>0 即該線降級**。
 */
export interface AnalysisLineOutcome<T, I> {
  results: T[];
  needsReview: I[];
}

/**
 * `AiAnalysisService.analyzeAndPersist` 結果（供 processor 收斂 job 狀態）。
 * `needsReview`=三線降級輸入總數；**>0 → job-level partial**（AC-42.5/INV-6，某 query/某線 LLM 失敗不整批失敗）。
 */
export interface AiAnalysisResult {
  answersCount: number;
  citedCount: number;
  metricsCount: number;
  needsReview: number;
}
