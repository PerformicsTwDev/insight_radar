/**
 * 專案唯一的 **canonical JSON 序列化**（SSOT）。遞迴排序物件 key（陣列**保序**——序列多具有序語意，
 * 如 `monthlyVolumes`；集合語意的陣列須由呼叫端先排序再傳入），使「內容相同、鍵序不同」得**相同**
 * 序列化字串。供所有內容定址雜湊共用同一序列化，避免各處各寫一份而漂移：
 * - idempotency key（seeds + params，NFR-7）
 * - snapshot checksum（不可變/可重現，NFR-7）
 * - **per-view AI 洞察 filters-hash**（S9 / AC-32.2：`filters-hash` 必須與 `/query` 用同一 canonical
 *   序列化，篩選語意等價者得同一 cache key、避免 miss 重打 LLM 或髒命中）
 */
export function canonicalize(value: unknown): unknown {
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

/** canonical 表示 → 決定性 JSON 字串（鍵序無關）。內容定址雜湊的**輸入單點**。 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
