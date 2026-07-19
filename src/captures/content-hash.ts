import { canonicalStringify } from '../common/canonical-json';
import { sha256Hex } from '../common/sha256';

/**
 * Capture content-hash（S16 / AC-36.2）——raw ingestion 的**唯一去重鍵**：
 * `contentHash = sha256(canonical(source, schemaVersion, item))`。同來源同內容重送 → 同 hash → 去重
 * （`captures.content_hash` NOT NULL + `@@unique`）。
 *
 * canonical 序列化**複用專案唯一的 SSOT**（`common/canonical-json`，與 idempotency key / snapshot checksum /
 * per-view filters-hash 同一套：遞迴排序物件鍵、陣列保序、`undefined` 由 JSON 略過），**不另造平行實作**——
 * 使「鍵序無關、語意相同 → 同 hash」跨批穩定去重。`channel`/`platform` **不**入 hash（依 S16 公式僅
 * `source, schemaVersion, item`）。
 */
export function captureContentHash(input: {
  source: string;
  schemaVersion: string;
  item: unknown;
}): string {
  return sha256Hex(canonicalStringify([input.source, input.schemaVersion, input.item]));
}
