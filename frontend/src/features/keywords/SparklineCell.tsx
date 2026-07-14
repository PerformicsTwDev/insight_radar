import type { ReactElement } from 'react';
import { buildSparkline, type MonthlyVolumePoint } from '../../lib/sparkline';
import { EM_DASH } from '../../lib/keywordsTable';

/**
 * Self-drawn SVG sparkline cell for the 搜尋趨勢 column (T2.2, FR-4). The pure
 * `buildSparkline` yields polyline segments split across null months; here each
 * segment is drawn as a `<polyline>` (or a `<circle>` dot for an isolated point),
 * so a missing month is a **visible break** — never a dip-to-zero (C12). A series
 * with < 2 non-null points renders an accessible 無趨勢資料 marker (`—`), not a
 * flat 0 line (FR-21). Stroke colour comes from the `--color-brand` token (no hex).
 */

const NO_DATA_LABEL = '無趨勢資料';
const TREND_LABEL = '搜尋趨勢走勢';
const STROKE_WIDTH = 1.5;
const DOT_RADIUS = 1.5;

export interface SparklineCellProps {
  readonly volumes: readonly MonthlyVolumePoint[];
}

export function SparklineCell({ volumes }: SparklineCellProps): ReactElement {
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
  return (
    <svg
      role="img"
      aria-label={TREND_LABEL}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
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
  );
}
