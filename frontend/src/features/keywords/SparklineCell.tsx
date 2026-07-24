import type { ReactElement } from 'react';
import { buildSparkline, type MonthlyVolumePoint } from '../../lib/sparkline';
import { EM_DASH } from '../../lib/keywordsTable';
import { TREND_TYPE_COLOR, trendInline, trendTooltip } from '../../lib/trend';
import { config } from '../../config/env';

/**
 * Self-drawn SVG sparkline cell for the 搜尋趨勢TTM column (T2.2, FR-4; M7-R2a). The pure
 * `buildSparkline` yields polyline segments split across null months; here each
 * segment is drawn as a `<polyline>` (or a `<circle>` dot for an isolated point),
 * so a missing month is a **visible break** — never a dip-to-zero (C12). A series
 * with < 2 non-null points renders an accessible 無趨勢資料 marker (`—`), not a
 * flat 0 line (FR-21). Stroke colour comes from the `--color-brand` token (no hex).
 *
 * Beside the sparkline the signed TTM % renders **inline** (M7-R2a): a directional
 * arrow + integer % coloured by the 4 trend types (`TREND_TYPE_COLOR` SSOT); an
 * unclassifiable series (÷0 / < 2 points) shows `—` inline rather than a fabricated %.
 */

const NO_DATA_LABEL = '無趨勢資料';
const TREND_LABEL = '搜尋趨勢走勢';
const STROKE_WIDTH = 1.5;
const DOT_RADIUS = 1.5;

export interface SparklineCellProps {
  readonly volumes: readonly MonthlyVolumePoint[];
  /**
   * Render the trend CLASSIFICATION annotations — the inline signed TTM % (M7-R2a) + the hover
   * type/% `<title>` tooltip (FR-21). Default true. The 追蹤清單 detail 走勢 column passes `false`
   * (M7-R23 / xhigh [9]): its series is per-`fetchedAt` metric-revision snapshots, not intra-year
   * monthly TTM, so the 12-month-calibrated trend type/%/colour would be miscalibrated there — the
   * sparkline line still draws, only the classification is dropped.
   */
  readonly showTrend?: boolean;
}

export function SparklineCell({ volumes, showTrend = true }: SparklineCellProps): ReactElement {
  const result = buildSparkline(volumes);

  if (!result.hasData) {
    // 無資料：渲染可及性 marker（`—`），絕不畫 0 線（C12 / FR-21）。
    return (
      <span role="img" aria-label={NO_DATA_LABEL} className="text-white/40">
        {EM_DASH}
      </span>
    );
  }

  const { width, height, segments } = result.geometry;
  // FR-21: the hover tooltip shows the trend 型別 + %. Null when the series can't be classified
  // (e.g. first non-null is 0) OR when trend classification is suppressed (M7-R23, non-TTM series).
  const tooltip = showTrend
    ? trendTooltip(volumes, config.trendStableMax, config.trendSurgeMin)
    : null;
  // M7-R2a: the signed % renders inline beside the sparkline, coloured by trend type; an
  // unclassifiable % (÷0) shows — inline (never a fabricated %) while the sparkline still draws.
  const inline = showTrend
    ? trendInline(volumes, config.trendStableMax, config.trendSurgeMin)
    : null;
  return (
    <span className="flex items-center gap-2">
      <svg
        role="img"
        aria-label={TREND_LABEL}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0 overflow-visible"
      >
        {tooltip ? <title>{tooltip}</title> : null}
        {segments.map((segment, index) =>
          segment.length === 1 ? (
            // 斷點兩側的孤立單點以圓點呈現（polyline 需 >=2 點才可見），仍是真實資料而非 0。
            <circle
              key={`seg-${index}`}
              cx={segment[0].x}
              cy={segment[0].y}
              r={DOT_RADIUS}
              className="fill-brand"
            />
          ) : (
            <polyline
              key={`seg-${index}`}
              points={segment.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              className="stroke-brand"
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ),
        )}
      </svg>
      {!showTrend ? null : inline ? (
        // Colour from the TREND_TYPE_COLOR SSOT (a type→colour lookup can't be JIT-safelisted
        // into a static Tailwind class without a safelist) — applied inline, like the intent chips.
        <span
          className="font-mono text-xs tabular-nums"
          data-trend-type={inline.type}
          style={{ color: TREND_TYPE_COLOR[inline.type] }}
        >
          {inline.text}
        </span>
      ) : (
        <span className="font-mono text-xs text-white/40">{EM_DASH}</span>
      )}
    </span>
  );
}
