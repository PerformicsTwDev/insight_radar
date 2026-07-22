/**
 * per-keyword AI 歸納搜尋意圖摘要（FR-31，SERP-grounded）的服務型別（T12.1）。
 */

/**
 * 該關鍵字經 extension `googleSearch` 渠道擷取、進 ingestion 後合流的 SERP 捕獲內容（`AiSearchCapture`
 * 的分析投影）——**歸納的唯一輸入**（grounding-first，AC-31.6）。為**第三方不可信內容**（S19）：
 * `blocks`（AI Overview text blocks / 自然結果 / PAA 的中立化 blocks）與 `references`（引用來源）皆須經
 * prompt-injection 隔離後才餵給 LLM。
 */
export interface SerpCapture {
  /** 中立化 SERP text blocks（AI Overview / 自然結果 / PAA）。 */
  blocks: unknown[];
  /** SERP 引用來源（`[{ title, link, snippet?, source?, index }]`）；缺 grounding→`[]`（不編造）。 */
  references?: unknown[];
}

/**
 * 摘要結果。`summary`＝long-form 意圖摘要（zh-TW）；LLM 失敗（拋錯/refusal/malformed/空）→ `summary=null`
 * （明確 null、**不污染其他字**的批次語意，AC-31.4）。
 */
export interface AiIntentSummary {
  normalizedText: string;
  summary: string | null;
}
