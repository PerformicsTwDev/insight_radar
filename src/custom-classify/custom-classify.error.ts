/**
 * 自訂分類標籤生成失敗（LLM refusal / content_filter / malformed，T12.7/AC-34.1）。由 controller filter 映射為
 * 502（上游 LLM 失敗、與 ai-insight 一致）；訊息經 scrubSecrets。**不**落庫半成品（僅成功才存 custom_classifications）。
 */
export class CustomClassifyGenerationError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CustomClassifyGenerationError';
  }
}
