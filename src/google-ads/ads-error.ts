/**
 * Google Ads 錯誤分類（T3.6 / TC-16、Design §11）。
 *
 * **可重試（暫時性配額）**：`RESOURCE_EXHAUSTED`（per-CID ~1 QPS 超量）與
 * `RESOURCE_TEMPORARILY_EXHAUSTED`（通用 token-bucket）——兩者皆是。
 * **不可重試**：`InvalidArgument`（>20 seed、resource name 格式錯）與其餘未知錯誤——直接拋
 * （避免放大 Ads QPS；基礎設施故障交由 BullMQ job-level retry）。
 *
 * 已對齊 google-ads-api@24.1.0：失敗解碼為 `GoogleAdsFailure`，`errors[].error_code` 為**單鍵物件**
 * （如 `{ quota_error: 'RESOURCE_EXHAUSTED' }`），enum 值多為名稱字串，亦相容 proto int
 * （quota_error: RESOURCE_EXHAUSTED=2、RESOURCE_TEMPORARILY_EXHAUSTED=4）。未解碼時退回 gRPC
 * 狀態碼（RESOURCE_EXHAUSTED=8）。
 */
const RETRYABLE_QUOTA_NAMES = new Set(['RESOURCE_EXHAUSTED', 'RESOURCE_TEMPORARILY_EXHAUSTED']);
const RETRYABLE_QUOTA_INTS = new Set([2, 4]);
/** gRPC status code：RESOURCE_EXHAUSTED = 8。 */
const GRPC_RESOURCE_EXHAUSTED = 8;

interface GoogleAdsErrorItem {
  error_code?: Record<string, unknown> | null;
}

function isRetryableQuotaValue(value: unknown): boolean {
  return (
    (typeof value === 'string' && RETRYABLE_QUOTA_NAMES.has(value)) ||
    (typeof value === 'number' && RETRYABLE_QUOTA_INTS.has(value))
  );
}

export function isRetryableAdsError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  // 未解碼的 raw gRPC 錯誤：數值 8 或扁平字串 code。
  if (code === GRPC_RESOURCE_EXHAUSTED) {
    return true;
  }
  if (typeof code === 'string' && RETRYABLE_QUOTA_NAMES.has(code)) {
    return true;
  }
  // GoogleAdsFailure：errors[].error_code.quota_error 命中可重試集合。
  const errors = (err as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return false;
  }
  return (errors as GoogleAdsErrorItem[]).some((item) =>
    isRetryableQuotaValue(item?.error_code?.quota_error),
  );
}
