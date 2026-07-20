import { canonicalStringify } from '../common/canonical-json';
import { sha256Hex } from '../common/sha256';

/**
 * Capture content-hash（S16 / AC-36.2；owner-scoped，M13-R1/#552）——raw ingestion 的**唯一去重鍵**：
 * `contentHash = sha256(canonical(ownerId?, source, schemaVersion, item))`。**同 owner** 同來源同內容重送 →
 * 同 hash → 去重（`captures.content_hash` NOT NULL + 全域 `@@unique`）。
 *
 * **owner 分範圍（S16／對齊 S12b/#358）**：`ownerId` fold 入 hash 輸入——不同 session owner 送位元相同內容得
 * **不同** hash（各落自己一列、各回自己 id，杜絕跨租戶 ON CONFLICT DO NOTHING 回不可讀 id/丟列，#552）；
 * 機器 x-api-key **null-owner** 之間 `ownerId=null` 相同 → 同 hash → **全域去重**（與 keyword-analysis
 * idempotency「機器 actor 間仍全域去重」S12b line 1863 同型）。此設計保留全域 `@@unique([content_hash])`、
 * **無 schema migration**（僅 hash 輸入變）；不採 `[ownerId, contentHash]` 複合索引（Postgres 預設
 * NULL DISTINCT → 兩 null-owner 列不去重，違「機器全域去重」）。
 *
 * canonical 序列化**複用專案唯一的 SSOT**（`common/canonical-json`，與 idempotency key / snapshot checksum /
 * per-view filters-hash 同一套：遞迴排序物件鍵、陣列保序、`undefined` 由 JSON 略過），**不另造平行實作**——
 * 使「鍵序無關、語意相同 → 同 hash」跨批穩定去重。`channel`/`platform` **不**入 hash（依 S16 公式僅
 * `ownerId, source, schemaVersion, item`）。
 */
export function captureContentHash(input: {
  ownerId: string | null;
  source: string;
  schemaVersion: string;
  item: unknown;
}): string {
  return sha256Hex(
    canonicalStringify({
      owner: input.ownerId,
      source: input.source,
      schemaVersion: input.schemaVersion,
      item: input.item,
    }),
  );
}
