/**
 * Pipeline 延遲預算模型（T4.5，NFR-1；Design §13 公式）。純函式——以可調參數模擬單 job 各 phase 耗時，
 * 驗證 **A/B 重疊**結構：Ads 端被 ~1 QPS 綁死（瓶頸、序列化），LLM 端可並發；邊拓展邊貼標使
 * `T_total ≈ max(T_expand, T_label) + 尾段`。供容量規劃與 NFR-1（單 job p95 < 30s）結構性驗證。
 *
 * 各 phase 的實際量測（observability 欄位）為 T7.2 範疇——本模型只做**結構**估算，不跑真實 I/O。
 */
export interface LatencyParams {
  /** seed 數。 */
  nSeeds: number;
  /** 每次 `GenerateKeywordIdeas` 的 seed 批量（≤20，預設 15）。 */
  batchSize: number;
  /** Ads QPS（per CID，瓶頸 ~1）。 */
  qpsAds: number;
  /** 拓展後待貼標的關鍵字總數。 */
  nKeywords: number;
  /** intent 快取命中率 0..1（只貼標 cache-miss）。 */
  cacheHitRate: number;
  /** 每個 LLM prompt 的關鍵字數（預設 30）。 */
  kKwPerPrompt: number;
  /** LLM 並發上限（`p-limit`，預設 6）。 */
  cLlm: number;
  /** 單一 LLM prompt 往返耗時（毫秒）。 */
  tPromptMs: number;
  /** 尾段耗時（最後一批貼標於拓展結束後的殘餘；毫秒）。 */
  tailMs: number;
}

export interface LatencyEstimate {
  nAdsRequests: number;
  tExpandMs: number;
  nLlmKeywords: number;
  nLlmPrompts: number;
  tLabelMs: number;
  tTotalMs: number;
}

/** 依 Design §13 公式估算單 job 的延遲預算（A/B 階段重疊）。 */
export function estimateLatency(p: LatencyParams): LatencyEstimate {
  const nAdsRequests = Math.ceil(p.nSeeds / p.batchSize);
  const tExpandMs = (nAdsRequests / p.qpsAds) * 1000; // 被 1 QPS 綁死、序列化

  const nLlmKeywords = Math.round(p.nKeywords * (1 - p.cacheHitRate)); // 只貼標 cache-miss
  const nLlmPrompts = Math.ceil(nLlmKeywords / p.kKwPerPrompt);
  const tLabelMs = (nLlmPrompts / p.cLlm) * p.tPromptMs; // 並發 C_llm、單 prompt 往返 t_prompt

  const tTotalMs = Math.max(tExpandMs, tLabelMs) + p.tailMs; // A/B 重疊
  return { nAdsRequests, tExpandMs, nLlmKeywords, nLlmPrompts, tLabelMs, tTotalMs };
}
