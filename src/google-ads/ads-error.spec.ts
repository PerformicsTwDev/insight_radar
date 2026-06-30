import { isRetryableAdsError } from './ads-error';

/** GoogleAdsFailure 形狀（已對齊 google-ads-api@24.1.0：errors[].error_code 為單鍵物件、enum 為名稱字串）。 */
function adsFailure(category: string, code: string | number): unknown {
  return { errors: [{ error_code: { [category]: code }, message: String(code) }] };
}

describe('isRetryableAdsError (T3.6 / TC-16 error classifier)', () => {
  describe('retryable — Ads 暫時性配額錯誤（兩者皆可重試）', () => {
    it('quota_error RESOURCE_EXHAUSTED (enum name)', () => {
      expect(isRetryableAdsError(adsFailure('quota_error', 'RESOURCE_EXHAUSTED'))).toBe(true);
    });
    it('quota_error RESOURCE_TEMPORARILY_EXHAUSTED (enum name)', () => {
      expect(isRetryableAdsError(adsFailure('quota_error', 'RESOURCE_TEMPORARILY_EXHAUSTED'))).toBe(
        true,
      );
    });
    it('quota_error as int enum (RESOURCE_EXHAUSTED=2, RESOURCE_TEMPORARILY_EXHAUSTED=4)', () => {
      expect(isRetryableAdsError(adsFailure('quota_error', 2))).toBe(true);
      expect(isRetryableAdsError(adsFailure('quota_error', 4))).toBe(true);
    });
    it('raw gRPC status code 8 (RESOURCE_EXHAUSTED) when not decoded to GoogleAdsFailure', () => {
      expect(isRetryableAdsError({ code: 8, message: 'resource exhausted' })).toBe(true);
    });
    it('flat string code shape { code: "RESOURCE_EXHAUSTED" }', () => {
      expect(isRetryableAdsError({ code: 'RESOURCE_EXHAUSTED' })).toBe(true);
    });
  });

  describe('non-retryable — 程式錯誤/未知一律不重試（直接拋）', () => {
    it('request_error (InvalidArgument family) → false', () => {
      expect(isRetryableAdsError(adsFailure('request_error', 'RESOURCE_NAME_MALFORMED'))).toBe(
        false,
      );
    });
    it('quota_error ACCESS_PROHIBITED (非兩個可重試值) → false', () => {
      expect(isRetryableAdsError(adsFailure('quota_error', 'ACCESS_PROHIBITED'))).toBe(false);
      expect(isRetryableAdsError(adsFailure('quota_error', 3))).toBe(false);
    });
    it('gRPC INVALID_ARGUMENT code 3 → false', () => {
      expect(isRetryableAdsError({ code: 3 })).toBe(false);
    });
    it('plain Error / unknown shapes → false', () => {
      expect(isRetryableAdsError(new Error('boom'))).toBe(false);
      expect(isRetryableAdsError({ errors: 'not-an-array' })).toBe(false);
      expect(isRetryableAdsError({})).toBe(false);
      expect(isRetryableAdsError(null)).toBe(false);
      expect(isRetryableAdsError(undefined)).toBe(false);
    });
  });
});
