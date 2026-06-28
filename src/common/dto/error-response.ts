/**
 * 統一錯誤回應格式（T0.6）。所有未處理例外/驗證失敗都序列化成此形狀，
 * 不洩漏 stack/祕密；驗證失敗時帶 `fields` 欄位級錯誤。
 */
export interface ErrorResponse {
  /** HTTP 狀態碼。 */
  statusCode: number;
  /** 機器可讀代碼（如 `NOT_FOUND`、`VALIDATION_FAILED`）。 */
  code: string;
  /** 人類可讀訊息（已遮蔽內部細節）。 */
  message: string;
  /** 欄位級驗證錯誤（property → 訊息陣列）；僅驗證失敗時出現。 */
  fields?: Record<string, string[]>;
  /** 請求路徑。 */
  path: string;
  /** ISO8601 時間戳。 */
  timestamp: string;
}
