/**
 * Pure trend-series assembly (T2.4, FR-5 → Design §6 C10). Transforms the backend
 * trend view (`axis` + `total`) and selected keyword rows' `monthlyVolumes` into
 * Chart.js line datasets — **no React, no IO** (core `src/lib/**`, ≥90% gate).
 *
 * THE C10 trap lives here: the aggregate line AND every per-keyword line share the
 * **backend `axis`** (the trend view's ordered month labels). A keyword row's
 * `monthlyVolumes` is aligned onto that axis **by position** — the frontend never
 * re-derives or reorders months (deriving months frontend-side causes month-axis
 * off-by-one / two-line misalignment). {@link monthKey} mirrors the backend key
 * (`build-trend.ts`) exactly so a row month maps to the same axis slot.
 *
 * Correctness single-points honoured:
 * - **C10**: axis is authoritative; per-keyword series aligned by position to it.
 * - **C12 (null 不補 0)**: an axis month absent from a row — or present with
 *   `searches === null` — becomes a `null` gap (a break in the line), never 0. A
 *   real `0` is preserved. (The aggregate `total` keeps the backend's semantics:
 *   an empty month is `0`, sustaining a continuous grand-total line.)
 */

/**
 * Minimal month-series element for axis alignment (backend `MonthlySearchVolume`).
 * The api `MonthlyVolume` (`{ year, month, searches }`) is structurally assignable.
 */
export interface AxisMonthlyVolume {
  readonly year: number;
  readonly month: number;
  readonly searches: number | null;
}

/** A keyword row reduced to what a trend line needs: its label + monthly series. */
export interface KeywordSeriesInput {
  readonly keyword: string;
  readonly volumes: readonly AxisMonthlyVolume[];
}

/** Line style for the aggregate ("全部搜尋詞加總") series (injected — lib stays presentation-free). */
export interface AggregateStyle {
  readonly label: string;
  readonly color: string;
  readonly fillColor: string;
}

/** A Chart.js line dataset (structural subset we produce; extra opts set component-side). */
export interface TrendDataset {
  readonly label: string;
  readonly data: (number | null)[];
  readonly borderColor: string;
  readonly backgroundColor: string;
  readonly fill: boolean;
}

/** Assembled Chart.js `data` (labels = the backend axis; datasets = aggregate + per-keyword). */
export interface TrendChartData {
  readonly labels: readonly string[];
  readonly datasets: readonly TrendDataset[];
}

/** A neutral tooltip point (decoupled from Chart.js `TooltipItem`), fed by the component. */
export interface TrendTooltipPoint {
  readonly label: string;
  readonly value: number | null;
  readonly color: string;
}

/** A formatted external-tooltip row (`value` already null-safe: `—` for null, C12). */
export interface TooltipRow {
  readonly label: string;
  readonly value: string;
  readonly color: string;
}

export interface AssembleTrendParams {
  readonly axis: readonly string[];
  readonly total: readonly number[];
  readonly keywords?: readonly KeywordSeriesInput[];
  readonly palette: readonly string[];
  readonly aggregate: AggregateStyle;
}

/** No-data marker for null / missing values in the tooltip (mirrors the table's `—`, C12). */
const EM_DASH = '—';

/**
 * `(year, month)` → `'YYYY-MM'` — **identical** to the backend's `monthKey`
 * (`build-trend.ts`): zero-padded month so lexical order equals chronological
 * order. This exact parity is what lets {@link alignToAxis} match a row's month to
 * the authoritative axis slot instead of re-deriving months (C10).
 */
export function monthKey(v: { readonly year: number; readonly month: number }): string {
  return `${v.year}-${String(v.month).padStart(2, '0')}`;
}

/**
 * Align a row's monthly volumes onto the backend `axis` **by position** (C10). Each
 * axis month gets that month's `searches`, or `null` when the row has no such month
 * (a gap, never 0 — C12); a month with `searches === null` is likewise a `null` gap.
 * A month present in the row but **not** on the axis is dropped (the axis is
 * authoritative). A real `0` is preserved.
 */
export function alignToAxis(
  volumes: readonly AxisMonthlyVolume[],
  axis: readonly string[],
): (number | null)[] {
  const byKey = new Map<string, number | null>();
  for (const v of volumes) {
    byKey.set(monthKey(v), v.searches);
  }
  // Map over the AXIS (not the row): extra row months fall away; absent months → null.
  return axis.map((key) => byKey.get(key) ?? null);
}

/** Pick the palette colour for a keyword line by index, cycling modulo palette length. */
export function pickColor(index: number, palette: readonly string[]): string {
  return palette[index % palette.length];
}

/**
 * Assemble Chart.js datasets: the aggregate line first (from `total`, brand style,
 * area fill), then one axis-aligned line per selected keyword (10-colour cycle, no
 * fill). Every per-keyword series is aligned to the same `axis` (C10) with `null`
 * gaps (C12). `labels` = the backend axis verbatim.
 */
export function assembleTrendDatasets(params: AssembleTrendParams): TrendChartData {
  const { axis, total, keywords = [], palette, aggregate } = params;

  const aggregateDataset: TrendDataset = {
    label: aggregate.label,
    data: [...total],
    borderColor: aggregate.color,
    backgroundColor: aggregate.fillColor,
    fill: true,
  };

  const keywordDatasets: TrendDataset[] = keywords.map((keyword, index) => {
    const color = pickColor(index, palette);
    return {
      label: keyword.keyword,
      data: alignToAxis(keyword.volumes, axis),
      borderColor: color,
      backgroundColor: color,
      fill: false,
    };
  });

  return { labels: [...axis], datasets: [aggregateDataset, ...keywordDatasets] };
}

/** Null-safe tooltip value: `—` for null / undefined (never 0, C12); a number → grouped digits. */
export function formatTooltipValue(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return EM_DASH;
  }
  return value.toLocaleString('en-US');
}

/** Format tooltip points into rows, keeping each series colour and a null-safe value. */
export function buildTooltipRows(points: readonly TrendTooltipPoint[]): TooltipRow[] {
  return points.map((point) => ({
    label: point.label,
    value: formatTooltipValue(point.value),
    color: point.color,
  }));
}
