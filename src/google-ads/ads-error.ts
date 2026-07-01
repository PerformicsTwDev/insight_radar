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
/** gRPC status code：INVALID_ARGUMENT = 3（永久性請求錯誤——重試無益）。 */
const GRPC_INVALID_ARGUMENT = 3;

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

/** 是否為已解碼的 `GoogleAdsFailure`（`errors[].error_code` 為單鍵物件）。 */
function isGoogleAdsFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const errors = (err as { errors?: unknown }).errors;
  return (
    Array.isArray(errors) &&
    (errors as GoogleAdsErrorItem[]).some(
      (item) => item?.error_code != null && typeof item.error_code === 'object',
    )
  );
}

/**
 * **不可重試**的 Ads 錯誤（T7.1）：已解碼 `GoogleAdsFailure` 但**非**暫時性配額——如 `InvalidArgument`
 * （>20 seed、resource name 格式錯）、`request_error`/`field_error` 等程式/請求錯誤。重試只會以同一非法請求
 * 重打 Ads（放大用量、無助於成功），故 job 級應**終態失敗、不重試**（Design §11）。未解碼/未知錯誤**不**歸此類
 * （保留 BullMQ 重試安全網，避免誤殺暫時性基礎設施故障）。
 */
export function isNonRetryableAdsError(err: unknown): boolean {
  // 未解碼的 raw gRPC INVALID_ARGUMENT（code 3）——與 isRetryableAdsError 處理 code 8 對稱；code 3 為永久性
  // 請求錯誤（其餘 gRPC 碼多為暫時性，留給 UNKNOWN 重試安全網，不誤殺）。
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === GRPC_INVALID_ARGUMENT
  ) {
    return true;
  }
  return isGoogleAdsFailure(err) && !isRetryableAdsError(err);
}
