import { pickColor, type AggregateStyle } from './trendSeries';

/**
 * Pure tracking-volume series assembly (T5.6, FR-19 → backend FR-30 / Design §9.2).
 * Transforms a tracking list's `series` response — the aggregate `total` and each
 * member's per-observation `series` — into Chart.js line datasets on the
 * **`fetchedAt` observation axis** (NOT the month axis). **No React, no IO** (core
 * `src/lib/**`, ≥90% gate).
 *
 * THIS IS THE C11 SINGLE-POINT — deliberately separate from {@link ./trendSeries}
 * (the C10 **month** axis). The tracking time-series X axis is the observation
 * timepoint `fetchedAt` (a metric revision snapshot, Design §9.2 / S1), never a
 * month bucket. Mixing the two would draw a fake daily/monthly trend over what are
 * really sparse "value changed" observations.
 *
 * Correctness single-points honoured (backend Design §9.2 semantics, verbatim):
 * - **Aggregate line = `total` verbatim**: the backend already sums each point's
 *   non-null members (`avgMonthlySearches`) and emits `0` where all are missing
 *   (AC-5.3 — a continuous grand-total line). The frontend passes it through; it
 *   NEVER re-nulls the aggregate.
 * - **Member line = null break (缺點≠0)**: an observation point a member lacks
 *   becomes a `null` gap (a break in the line), never 0 (AC-30.2). A real `0` is
 *   preserved.
 * - **Empty / first-run = no line (空≠假 0 線)**: an empty axis (no snapshots / none
 *   in range, AC-30.3) yields an identifiable `{ isEmpty: true }` — the caller shows
 *   "尚無時序資料" and draws NOTHING, never a fabricated flat 0 line.
 */

/** One member observation point on the `fetchedAt` axis (backend `SeriesPoint`, wire subset). */
export interface VolumeSeriesPoint {
  /** ISO `fetchedAt` observation timepoint (the axis key). */
  readonly fetchedAt: string;
  /** Monthly search volume at this observation, or `null` (missing ≠ 0). */
  readonly avgMonthlySearches: number | null;
}

/** A member reduced to what a tracking line needs: its axis key, label + observation series. */
export interface VolumeMemberInput {
  /** Stable key (`normalizedText`) — the selection identity. */
  readonly key: string;
  /** Display label (`text`). */
  readonly label: string;
  /** The member's per-observation series (backend already aligns to the axis). */
  readonly series: readonly VolumeSeriesPoint[];
}

/** A Chart.js line dataset (structural subset we produce; extra opts set component-side). */
export interface VolumeDataset {
  readonly label: string;
  readonly data: (number | null)[];
  readonly borderColor: string;
  readonly backgroundColor: string;
  readonly fill: boolean;
}

export interface AssembleVolumeParams {
  /** The `fetchedAt` observation axis (ISO strings) — authoritative order (C11). */
  readonly axis: readonly string[];
  /** Aggregate line data aligned to the axis (backend: all-missing point → 0). */
  readonly total: readonly number[];
  /** The SELECTED members to draw as individual lines (aggregate is always drawn). */
  readonly members?: readonly VolumeMemberInput[];
  readonly palette: readonly string[];
  readonly aggregate: AggregateStyle;
}

/**
 * Assembled chart, or an identifiable empty state. `isEmpty` is a PURE concern (not
 * pushed to the component) so "空 → 不畫假 0 線" (AC-30.3) is locked in the ≥90% core.
 */
export type VolumeChartData =
  | { readonly isEmpty: true }
  | { readonly isEmpty: false; readonly labels: string[]; readonly datasets: VolumeDataset[] };

/** The three time-range windows (Issue #617 · AC-30.3). `all` → no `from` bound. */
export type SeriesRange = '6m' | '12m' | 'all';

/**
 * Format an ISO `fetchedAt` observation timepoint into a `YYYY-MM-DD` axis label,
 * normalised to **UTC** (mirrors the backend's UTC `from`/`to` convention, #471-2).
 * A malformed value falls back to the raw string (never throws).
 */
export function formatFetchedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}

/**
 * Align a member's observation series onto the `fetchedAt` axis **by observation key**
 * (C11 — axis is authoritative). Each axis point gets that point's
 * `avgMonthlySearches`, or `null` when the member has no observation there (a break,
 * never 0 — AC-30.2). A series point NOT on the axis is dropped; a real `0` is kept.
 */
export function alignSeriesToAxis(
  series: readonly VolumeSeriesPoint[],
  axis: readonly string[],
): (number | null)[] {
  const byKey = new Map<string, number | null>();
  for (const point of series) {
    byKey.set(point.fetchedAt, point.avgMonthlySearches);
  }
  // Map over the AXIS (not the series): a point off the axis falls away; an axis point
  // the member lacks → null (a break, never 0 — AC-30.2). A real 0 is preserved.
  return axis.map((key) => byKey.get(key) ?? null);
}

/**
 * Assemble the aggregate line (from `total`, brand style, area fill) plus one
 * axis-aligned line per selected member (10-colour cycle, no fill). An empty axis →
 * `{ isEmpty: true }` (no datasets, no fabricated 0 line — AC-30.3).
 */
export function assembleVolumeChart(params: AssembleVolumeParams): VolumeChartData {
  const { axis, total, members = [], palette, aggregate } = params;

  // 空/首次未跑（AC-30.3）：無觀測點 → 可辨識空態，不畫任何線（絕不補假 0 線）。
  if (axis.length === 0) {
    return { isEmpty: true };
  }

  const aggregateDataset: VolumeDataset = {
    label: aggregate.label,
    data: [...total], // §9.2：backend 已對全缺點補 0，加總線恆連續 — 前端原樣傳遞、不再 null 化。
    borderColor: aggregate.color,
    backgroundColor: aggregate.fillColor,
    fill: true,
  };

  const memberDatasets: VolumeDataset[] = members.map((member, index) => {
    const color = pickColor(index, palette);
    return {
      label: member.label,
      data: alignSeriesToAxis(member.series, axis), // C11：對齊 fetchedAt 軸、缺點 null 斷點。
      borderColor: color,
      backgroundColor: color,
      fill: false,
    };
  });

  return {
    isEmpty: false,
    labels: axis.map(formatFetchedAt),
    datasets: [aggregateDataset, ...memberDatasets],
  };
}

/**
 * Resolve a range window to its inclusive `from` ISO bound relative to `now` (UTC).
 * `6m`/`12m` → `now` minus that many months; `all` → `undefined` (no lower bound).
 *
 * Month subtraction is done WITHOUT day-overflow (#650): a bare
 * `setUTCMonth(getUTCMonth() - n)` rolls a day the target month lacks forward into
 * the NEXT month (Aug 31 → Feb 28 → Mar 3), drifting the 6M/12M bound ~3 days and
 * dropping/including a boundary snapshot. We pin to day-1 first so the month step can
 * never overflow, then clamp the original day-of-month to the target month's last
 * valid day (least-surprise: the bound stays inside the intended month, never leaks
 * into the next one). Time-of-day components are preserved. UTC-only throughout.
 */
export function rangeToFrom(range: SeriesRange, now: Date): string | undefined {
  if (range === 'all') {
    return undefined;
  }
  const months = range === '6m' ? 6 : 12;
  const from = new Date(now);
  from.setUTCDate(1); // pin to day-1 so the month step below can never day-overflow
  from.setUTCMonth(from.getUTCMonth() - months);
  // Day 0 of the month AFTER the target month = the target month's last day.
  const lastDayOfTargetMonth = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0),
  ).getUTCDate();
  from.setUTCDate(Math.min(now.getUTCDate(), lastDayOfTargetMonth));
  return from.toISOString();
}
