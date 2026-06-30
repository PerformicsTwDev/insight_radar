import { createHash } from 'node:crypto';

/**
 * Snapshot 列資料（result table 5 欄 + 攤平指標 + intent；存 `snapshot_rows.data` Json）。
 * 不可變快照的內容單位（NFR-7 / TC-17）。
 */
export interface SnapshotRowData {
  text: string;
  normalizedText: string;
  avgMonthlySearches: number | null;
  competition: string;
  competitionIndex: number | null;
  cpcLow: number | null;
  cpcHigh: number | null;
  intent: string[];
}

/** 遞迴排序物件 key（陣列保序）→ 穩定序列化，使 checksum 與 key 順序無關。 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = canonicalize(obj[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * 內容定址 checksum（NFR-7 不可變/可重現）：以 `normalizedText` 為穩定排序 → canonical JSON →
 * sha256。**相同內容（不論列序/鍵序）得相同 checksum**；任一指標/intent 變動則改變。
 */
export function computeChecksum(rows: SnapshotRowData[]): string {
  const ordered = [...rows].sort((a, b) =>
    a.normalizedText < b.normalizedText ? -1 : a.normalizedText > b.normalizedText ? 1 : 0,
  );
  const canonical = JSON.stringify(ordered.map(canonicalize));
  return createHash('sha256').update(canonical).digest('hex');
}
