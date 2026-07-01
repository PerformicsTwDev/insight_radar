import type { MonthlySearchVolume } from '../google-ads/mapping/map-monthly-volumes';
import { sha256Hex } from '../common/sha256';

/**
 * Snapshot 列資料（result table 欄 + 攤平指標 + intent + 逐月搜量；存 `snapshot_rows.data` Json）。
 * 不可變快照的內容單位（NFR-7 / TC-17）。`monthlyVolumes` 為有序序列（供 trend 月分組 sum +
 * keywords top-N series，Design §5.1/§9.2）；canonical 保序、不排序陣列。
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
  monthlyVolumes: MonthlySearchVolume[];
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
 *
 * 不變式：陣列**保序**（canonical 不排序陣列，因 monthlyVolumes 等為有序序列）。故**集合語意**的
 * 陣列（如 `intent` 標籤）須由呼叫端先排序再傳入（processor `toSnapshotRow` 已 `[...intent].sort()`）。
 */
export function computeChecksum(rows: SnapshotRowData[]): string {
  const ordered = [...rows].sort((a, b) =>
    a.normalizedText < b.normalizedText ? -1 : a.normalizedText > b.normalizedText ? 1 : 0,
  );
  const canonical = JSON.stringify(ordered.map(canonicalize));
  return sha256Hex(canonical);
}
