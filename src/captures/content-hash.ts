import { createHash } from 'node:crypto';

/**
 * Capture content-hash（S16 / AC-36.2）——raw ingestion 的**唯一去重鍵**：
 * `contentHash = sha256(canonical(source, schemaVersion, item))`。
 *
 * `captures.content_hash` 為 NOT NULL + `@@unique`，故 T13.2「基本 raw 落庫」即需算出此值。**本 helper（純函式）
 * 只負責計算**；idempotency 的**去重行為**（同 hash 命中→回既有 id、計入 `deduped`、ON CONFLICT/慢路徑 fallback）
 * 與 `schemaVersion` allowlist（S15）留待 **T13.3**——T13.2 一律 `deduped=0`、逐筆 append。
 *
 * canonical 序列化以**遞迴排序物件鍵**保證「鍵序無關、語意相同→同 hash」（跨批重送穩定去重）；陣列順序保留
 * （語意相關）。`undefined` 屬性略過（JSON 慣例）。
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** 遞迴排序物件鍵（陣列順序保留）；回傳可被 `JSON.stringify` 穩定序列化的結構。 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) {
        sorted[key] = canonicalize(v);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * `sha256(canonical(source, schemaVersion, item))`（S16）——同來源同內容重送的唯一去重鍵。
 * `channel`/`platform` **不**入 hash（依 spec 公式僅 `source, schemaVersion, item`）。
 */
export function captureContentHash(input: {
  source: string;
  schemaVersion: string;
  item: unknown;
}): string {
  const canonical = canonicalJson([input.source, input.schemaVersion, input.item]);
  return createHash('sha256').update(canonical).digest('hex');
}
