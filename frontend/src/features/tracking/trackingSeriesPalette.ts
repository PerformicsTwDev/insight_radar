import type { AggregateStyle } from '../../lib/trendSeries';

/**
 * Tracking time-series line colours (T5.6, FR-19). Chart.js draws on a `<canvas>`,
 * which needs concrete colour strings (Tailwind utility classes / `var(--color-*)` do
 * not resolve inside canvas), so — like `trendPalette` — these are literal values kept
 * in one module. The aggregate ("全部成員加總") line mirrors the brand token; the
 * per-member cycle reuses the decorative {@link TREND_PALETTE} (no semantic meaning).
 */
export { TREND_PALETTE as TRACKING_MEMBER_PALETTE } from '../trend/trendPalette';

/** Aggregate ("全部成員加總") line: brand green + a translucent area fill (§9.2 continuous total). */
export const TRACKING_AGGREGATE: AggregateStyle = {
  label: '全部成員加總',
  color: '#52b788', // --color-brand
  fillColor: 'rgba(82, 183, 136, 0.15)',
};
