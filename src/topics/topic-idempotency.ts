import { sha256Hex } from '../common/sha256';

/**
 * 計算分群 job 的 idempotency key（T8.9，TC-46；Design §16.3）。
 *
 * 語意相同 → 同一 key：
 * - `analysisId`：綁定**特定分析**（M8-R7）——`idempotency_key` 為全域 unique，且 GET 以 `keywordAnalysisId`
 *   查 run；若只用內容定址（checksum）會使**兩個內容位元相同的不同分析**得同一 key → 後者複用前者的 run、
 *   不入列、且 `findLatestRunByAnalysis(後者)` 永遠 404。故 key **必含 analysisId** 作 scope。
 * - `snapshotChecksum`：綁定該分析的**特定不可變 snapshot**（內容變 → 不同 key）。
 * - `params`：以**鍵序無關的 canonical JSON** 序列化（embedding/umap/hdbscan/serpEnabled/prompt/schema 版本）。
 *
 * 故同分析 + 同 snapshot + 語意相同 params（鍵序不同）→ 同一 hash（命中回同一 runId、不重跑）；不同分析／
 * prompt/schema 版本變更 → 不同 key → 允許各自的 run。回傳 sha256 hex。
 */
export function computeTopicIdempotencyKey(
  analysisId: string,
  snapshotChecksum: string,
  params: Record<string, unknown>,
): string {
  const canonical = JSON.stringify({
    analysisId,
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
