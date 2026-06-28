import { createHash } from 'node:crypto';
import { normalizeText } from '../google-ads/normalize';

/**
 * 計算 keyword-analysis 的 idempotency key（TC-10，NFR-7）。
 *
 * 計算對象（語意相同 → 同一 key）：
 * - seeds：先以 **共用的 `normalizeText`**（去重/快取同一規則）正規化、去重、**排序成 canonical order**。
 * - params：以 **key 排序後的 canonical JSON** 序列化（鍵序不影響結果）。
 *
 * 故 `[A,B]`/`[B,A]`、大小寫/空白差異、params 鍵序不同但語意相同者 → 得同一 hash。
 * 回傳 sha256 hex；呼叫端組成 `idemp:{hash}` 快取 key。
 */
export function computeIdempotencyKey(seeds: string[], params: Record<string, unknown>): string {
  const canonicalSeeds = [...new Set(seeds.map(normalizeText))].sort();
  const canonical = JSON.stringify({
    seeds: canonicalSeeds,
    params: canonicalize(params),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * 遞迴產生鍵序無關的 canonical 表示：物件鍵排序後重建；陣列保持順序（語意相關）；
 * 純量原樣。確保 `{a,b}` 與 `{b,a}` 序列化結果相同。
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(record[key]);
        return acc;
      }, {});
  }
  return value;
}
