/**
 * AI 發想生成失敗（T12.10，FR-35 / AC-35.1）：LLM refusal / content_filter / 截斷 / malformed / 傳輸錯 →
 * 拋此**明確錯誤**（不回半成品冒充成功、不污染其他請求）。端點將其映射為 **502**（鏡像 ai-insight）。
 */
export class IdeationGenerationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IdeationGenerationError';
  }
}
