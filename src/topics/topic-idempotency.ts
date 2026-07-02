import { sha256Hex } from '../common/sha256';

/**
 * 計算分群 job 的 idempotency key（T8.9，TC-46；Design §16.3）。
 *
 * 語意相同 → 同一 key：
 * - `snapshotChecksum`：綁定**特定不可變 snapshot**（snapshot 內容變 → 不同 key）。
 * - `params`：以**鍵序無關的 canonical JSON** 序列化（embedding/umap/hdbscan/serpEnabled/prompt/schema 版本）。
 *
 * 故同 snapshot + 語意相同 params（鍵序不同）→ 同一 hash（命中回同一 runId、不重跑）；prompt/schema 版本
 * 變更 → 不同 key → 允許重跑。回傳 sha256 hex。
 */
export function computeTopicIdempotencyKey(
  snapshotChecksum: string,
  params: Record<string, unknown>,
): string {
  const canonical = JSON.stringify({
    checksum: snapshotChecksum,
    params: canonicalize(params),
  });
  return sha256Hex(canonical);
}

/**
 * 遞迴產生鍵序無關的 canonical 表示：物件鍵排序後重建；陣列保持順序（語意相關）；純量原樣。
 * 確保 `{a,b}` 與 `{b,a}` 序列化結果相同。
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
