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

// STUB (red): typed not-implemented shell so TC-8 imports resolve and fail on
// assertions, not on compile. Real implementation lands in the green commit.

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

export function monthKey(_v: { readonly year: number; readonly month: number }): string {
  return '';
}

export function alignToAxis(
  _volumes: readonly AxisMonthlyVolume[],
  _axis: readonly string[],
): (number | null)[] {
  return [];
}

export function pickColor(_index: number, _palette: readonly string[]): string {
  return '';
}

export function assembleTrendDatasets(_params: AssembleTrendParams): TrendChartData {
  return { labels: [], datasets: [] };
}

export function formatTooltipValue(_value: number | null | undefined): string {
  return '';
}

export function buildTooltipRows(_points: readonly TrendTooltipPoint[]): TooltipRow[] {
  return [];
}
