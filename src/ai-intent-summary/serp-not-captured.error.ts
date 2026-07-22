/**
 * grounding-first gate（AC-31.6）：該關鍵字**尚無 SERP 捕獲**時拋出——歸納一律以捕獲的 SERP 為輸入，
 * 無 SERP 不得僅憑關鍵字文字編造摘要。HTTP 邊界（T12.2 端點）將此映射為 `409` + `code=serp_not_captured`
 * （前端顯示「需先擷取搜尋結果」）。domain error（非 Nest HttpException）→ 服務層與傳輸層解耦、可於 batch
 * 語意中辨識。
 */
export class SerpNotCapturedError extends Error {
  /** 穩定錯誤碼（T12.2 端點映射 409 body 的 `code`）。 */
  readonly code = 'serp_not_captured';

  constructor(readonly normalizedText: string) {
    super(`No captured SERP for keyword "${normalizedText}"; capture the Google SERP first`);
    this.name = 'SerpNotCapturedError';
  }
}
