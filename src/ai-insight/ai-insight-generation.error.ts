/**
 * per-view AI 洞察生成失敗（AC-32.4）：LLM refusal / content_filter / 截斷 / malformed / 傳輸錯 →
 * 拋此**明確錯誤**（不回半截摘要冒充成功、不寫入快取、不污染其他請求）。端點（T12.4）將其映射為
 * 明確 HTTP 錯誤狀態。
 */
export class AiInsightGenerationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiInsightGenerationError';
  }
}
