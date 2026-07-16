import { microsToAmount } from '../google-ads/mapping/micros';

/**
 * 搜量時序組裝（T11.7，FR-30 AC-30.1~30.5 · Design §17.3；正確性單點 S2 null≠0）——**純函式**。
 *
 * 把某追蹤清單的 `VolumeSnapshot`（時序列）+ 成員基本面組成前端可畫圖的形狀：
 * - `axis`＝清單全部成員快照 `fetchedAt` 的**去重升冪聯集**（已由呼叫端依 from/to 過濾、scope 至現有成員）。
 * - 每成員 `series` **對齊 `axis`**：該時點有快照 → 該筆值；該時點無快照 → **斷點 `{ …null }`**（AC-30.2，不補 0）。
 * - `total[i]`＝該時點**非 null** 成員 `avgMonthlySearches` 之和；全部缺 → `0`（趨勢語意 AC-5.3/§9.2，恆為數字）。
 * - `summary.latestFetchedAt`＝全體快照最新 `fetchedAt`；**無快照 → `null` + `axis=[]` + 各成員 `series=[]`**
 *   （AC-30.3 空狀態，不回誤導假 0 線）。
 * - 每成員 `latest`＝該成員自己**最新一筆**快照的指標（AC-30.5 成員表 / sparkline 起點）；無則 `null`。
 *
 * **cpc（單值）**＝`microsToAmount(cpcLowMicros)`（沿用共用 mapper：`micros ÷ 1e6`、缺值→null，正確性單點）。
 * 快照存 low/high 兩欄，對外 `cpc` 取 **low**（floor bid 估計）——比照既有唯一「CPC 縮為單一純量」的
 * `cpc_histogram` view（Design §9.3：`cpcLow 落桶`）。此為 spec 未明定之處的收斂選擇（見任務筆記）。
 */

/** 純函式輸入：清單中繼（對外 `list` 面）。 */
export interface SeriesListMeta {
  listId: string;
  name: string;
  geo: string;
  language: string;
}

/** 純函式輸入：成員基本面（AC-30.5 表格欄位 addedAt/lastCheckedAt）。 */
export interface SeriesMemberInput {
  normalizedText: string;
  text: string;
  addedAt: Date;
  lastCheckedAt: Date | null;
}

/**
 * 純函式輸入：`VolumeSnapshot` 列投影（時序組裝所需欄位子集）。呼叫端須先依 from/to 過濾且 scope 至**現有成員**
 * （`normalizedText ∈ members`）——確保 axis 不含已移除成員遺留快照的孤點。
 */
export interface SeriesSnapshotInput {
  normalizedText: string;
  fetchedAt: Date;
  avgMonthlySearches: number | null;
  competition: string | null;
  cpcLowMicros: bigint | null;
}

/** 對外指標點（單時點；`cpc` 為單值，見模組註解）。 */
export interface SeriesMetricPoint {
  avgMonthlySearches: number | null;
  competition: string | null;
  cpc: number | null;
}

/** 對外時序點：指標點 + 其 `fetchedAt`（斷點時亦帶 axis 時間、指標全 null）。 */
export interface SeriesPoint extends SeriesMetricPoint {
  fetchedAt: Date;
}

/** 對外成員時序：基本面 + `latest`（最新快照指標）+ 對齊 axis 的 `series`。 */
export interface MemberSeries {
  normalizedText: string;
  text: string;
  addedAt: Date;
  lastCheckedAt: Date | null;
  latest: SeriesPoint | null;
  series: SeriesPoint[];
}

/** 對外時序回應（AC-30.1 形狀 + AC-30.5 每成員 latest）。 */
export interface VolumeSeriesResult {
  list: SeriesListMeta;
  axis: Date[];
  total: number[];
  members: MemberSeries[];
  summary: { memberCount: number; latestFetchedAt: Date | null };
}

/**
 * 單值 cpc（AC-30.1）＝`cpcLow ÷ 1e6`（沿用共用 mapper：缺值→null、不補 0；正確性單點）。bigint→string 後
 * 交 `microsToAmount`（其解析 `null`→null、`0`→0）。快照存 low/high 兩欄，對外取 **low**（見模組註解）。
 */
function toCpc(cpcLowMicros: bigint | null): number | null {
  return microsToAmount(cpcLowMicros === null ? null : cpcLowMicros.toString());
}

/** 快照列 → 對外指標點（cpc 單值化；avg/competition 原樣，缺值保持 null）。 */
function toMetricPoint(snap: SeriesSnapshotInput): SeriesMetricPoint {
  return {
    avgMonthlySearches: snap.avgMonthlySearches,
    competition: snap.competition,
    cpc: toCpc(snap.cpcLowMicros),
  };
}

/**
 * 組裝時序回應（見模組註解語意；純函式、無 I/O）。呼叫端須傳入**已依 from/to 過濾且 scope 至現有成員**的
 * 快照——本函式即以此輸入建 axis 聯集、per-member 對齊（缺點斷點 null）、total（非 null 之和、全缺→0）。
 */
export function assembleVolumeSeries(
  list: SeriesListMeta,
  members: SeriesMemberInput[],
  snapshots: SeriesSnapshotInput[],
): VolumeSeriesResult {
  // 1. axis = 全體快照 fetchedAt 的去重升冪聯集（以 epoch ms 為去重/排序 key；同批刷新之同一時點自然併點）。
  const axisTimes = [...new Set(snapshots.map((s) => s.fetchedAt.getTime()))].sort((a, b) => a - b);
  const axis = axisTimes.map((t) => new Date(t));

  // 2. 依成員索引快照：time(ms) → 指標點；同時追蹤每成員自身最新一筆（AC-30.5 latest）。
  const pointsByMember = new Map<string, Map<number, SeriesMetricPoint>>();
  const latestByMember = new Map<string, SeriesPoint>();
  for (const snap of snapshots) {
    const t = snap.fetchedAt.getTime();
    const point = toMetricPoint(snap);
    let byTime = pointsByMember.get(snap.normalizedText);
    if (!byTime) {
      byTime = new Map<number, SeriesMetricPoint>();
      pointsByMember.set(snap.normalizedText, byTime);
    }
    byTime.set(t, point);
    const prevLatest = latestByMember.get(snap.normalizedText);
    if (!prevLatest || t > prevLatest.fetchedAt.getTime()) {
      latestByMember.set(snap.normalizedText, { fetchedAt: snap.fetchedAt, ...point });
    }
  }

  // 3. per-member series 對齊 axis + total 累加。total 初始全 0（全缺→0，AC-30.2 恆為數字）。
  const total = axis.map(() => 0);
  const membersOut: MemberSeries[] = members.map((member) => {
    const byTime = pointsByMember.get(member.normalizedText);
    const series = axisTimes.map((t, i): SeriesPoint => {
      const present = byTime?.get(t);
      if (present) {
        if (present.avgMonthlySearches !== null) {
          total[i] += present.avgMonthlySearches; // 只累加非 null（AC-5.3）
        }
        return { fetchedAt: axis[i], ...present };
      }
      // 該成員該時點無快照 → 斷點（AC-30.2 null≠0，不補 0、不計入 total）。
      return { fetchedAt: axis[i], avgMonthlySearches: null, competition: null, cpc: null };
    });
    return {
      normalizedText: member.normalizedText,
      text: member.text,
      addedAt: member.addedAt,
      lastCheckedAt: member.lastCheckedAt,
      latest: latestByMember.get(member.normalizedText) ?? null,
      series,
    };
  });

  // 4. summary：memberCount = 清單成員數；latestFetchedAt = axis 末端（無快照→null，空狀態 AC-30.3）。
  const latestFetchedAt = axis.length > 0 ? axis[axis.length - 1] : null;
  return {
    list,
    axis,
    total,
    members: membersOut,
    summary: { memberCount: members.length, latestFetchedAt },
  };
}
