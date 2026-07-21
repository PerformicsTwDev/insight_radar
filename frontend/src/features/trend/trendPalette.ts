/**
 * Trend-chart line colours — the SINGLE place trend-line hex is defined (no
 * scattered hex, Design §3 tokens rule). Chart.js draws on a `<canvas>`, which
 * needs concrete colour strings (Tailwind utility classes / `var(--color-*)` do
 * not resolve inside canvas), so — unlike the table's `stroke-brand` sparkline —
 * these are literal values kept in one module.
 *
 * The aggregate line mirrors the brand token (`--color-brand`, index.css @theme).
 * The 10-colour cycle is **decorative** (no semantic meaning, unlike intentMap's
 * C2 intent colours) and deliberately excludes brand green so a per-keyword line
 * never blends into the aggregate line. First five entries seeded from design
 * tokens; the rest extend the cycle to ten distinguishable hues on the dark bg.
 *
 * ⚠ This is a **frozen decorative snapshot**, NOT a live mirror of `intentMap`: the
 * 4th slot keeps the pre-T6.2 navigational hue `#9b5de5` and is deliberately NOT
 * resynced to the C2 intent single-point (raised to `#B088EE` for WCAG AA text
 * contrast, index.css / intentMap). A trend line is a decorative canvas stroke, not
 * intent-bound text, so `#9b5de5` still clears the 1.4.11 non-text 3:1 bar; leaving
 * it frozen avoids shifting an existing trend hue and its visual golden (TC-49).
 */

import type { AggregateStyle } from '../../lib/trendSeries';

/** Aggregate ("全部搜尋詞加總") line: brand green + a translucent area fill (FR-5). */
export const TREND_AGGREGATE: AggregateStyle = {
  label: '全部搜尋詞加總',
  color: '#52b788', // --color-brand
  fillColor: 'rgba(82, 183, 136, 0.15)',
};

/** 10-colour cycle for per-keyword lines (FR-5). Cycled by index via `pickColor`. */
export const TREND_PALETTE: readonly string[] = [
  '#5bc0eb', // --color-intent-informational
  '#f4845f', // --color-trend-surge
  '#ffd166', // --color-intent-transactional
  '#9b5de5', // frozen decorative hue (pre-T6.2 navigational) — NOT the C2 token (now #B088EE)
  '#ef6f6c', // --color-trend-negative
  '#4cc9f0',
  '#f72585',
  '#80ed99',
  '#ff9f1c',
  '#a0c4ff',
];
