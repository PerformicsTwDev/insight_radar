/**
 * 解析 Google Ads 的 int64-as-string 數值欄位（gax `longs:String`）為有限 number。
 *
 * 缺值（null/undefined）/ 空白字串 / 非有限值 → **null**（**不補 0、不外漏 NaN**）。
 * 守住「缺值 ≠ 0」單點——上游若以空字串表示未設值，也不會被 `Number('')===0` 變成 0。
 * 單一 SSOT：avg_monthly_searches / monthly_searches / competition_index / year 共用。
 */
export function parseCount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
