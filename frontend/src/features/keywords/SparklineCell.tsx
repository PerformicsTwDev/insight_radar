import type { ReactElement } from 'react';
import type { MonthlyVolumePoint } from '../../lib/sparkline';

/** Self-drawn SVG sparkline cell for the 搜尋趨勢 column (T2.2, FR-4). */
export interface SparklineCellProps {
  readonly volumes: readonly MonthlyVolumePoint[];
}

// TDD red 空殼（T2.2）——green commit 才由 buildSparkline 幾何畫出 SVG polyline + null 斷點。
export function SparklineCell(_props: SparklineCellProps): ReactElement {
  return <span />;
}
