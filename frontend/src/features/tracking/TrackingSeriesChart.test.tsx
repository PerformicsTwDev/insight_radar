import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * TC-30 (component; FR-19 · backend FR-30 · §9.2) — the tracking series chart's
 * props-driven contract, tested in isolation (mirrors `TrendChart.test`). jsdom can't
 * render `<canvas>`, so `chart.js` is mocked and we assert the assembled datasets +
 * member-line selection wiring + the empty state (no chart, no fake 0 line, AC-30.3).
 */

const chart = vi.hoisted(() => ({ configs: [] as unknown[], destroys: { count: 0 } }));
vi.mock('chart.js', () => {
  class MockChart {
    static register = vi.fn();
    constructor(_canvas: unknown, config: unknown) {
      chart.configs.push(config);
    }
    update = vi.fn();
    destroy = (): void => {
      chart.destroys.count += 1;
    };
  }
  return { Chart: MockChart, registerables: [] };
});

import { TrackingSeriesChart } from './TrackingSeriesChart';
import type { VolumeMemberInput } from '../../lib/volumeSeries';

interface Dataset {
  label: string;
  data: (number | null)[];
}
interface Config {
  data: { labels: string[]; datasets: Dataset[] };
}
const lastConfig = (): Config => chart.configs[chart.configs.length - 1] as Config;

const AXIS = ['2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'];
const TOTAL = [100, 140];
const MEMBERS: VolumeMemberInput[] = [
  {
    key: 'running shoes',
    label: 'Running Shoes',
    series: [
      { fetchedAt: AXIS[0], avgMonthlySearches: 100 },
      { fetchedAt: AXIS[1], avgMonthlySearches: 140 },
    ],
  },
];

beforeEach(() => {
  chart.configs.length = 0;
  chart.destroys.count = 0;
});

describe('TC-30 · TrackingSeriesChart (props-driven chart contract)', () => {
  it('draws the aggregate line only by default', () => {
    render(<TrackingSeriesChart axis={AXIS} total={TOTAL} members={MEMBERS} />);
    expect(lastConfig().data.datasets).toHaveLength(1);
    expect(lastConfig().data.datasets[0].label).toBe('全部成員加總');
  });

  it('adds then removes a member line as its checkbox is toggled', () => {
    render(<TrackingSeriesChart axis={AXIS} total={TOTAL} members={MEMBERS} />);
    fireEvent.click(screen.getByRole('button', { name: /篩選成員/ }));
    const checkbox = screen.getByRole('checkbox', { name: 'Running Shoes' });

    fireEvent.click(checkbox); // select
    expect(lastConfig().data.datasets).toHaveLength(2);
    expect(lastConfig().data.datasets[1].data).toEqual([100, 140]);

    fireEvent.click(checkbox); // deselect
    expect(lastConfig().data.datasets).toHaveLength(1);
  });

  it('shows a no-selectable-members hint when the popover opens with no members', () => {
    render(<TrackingSeriesChart axis={AXIS} total={TOTAL} members={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /篩選成員/ }));
    expect(screen.getByText('尚無可選成員')).toBeInTheDocument();
    expect(lastConfig().data.datasets).toHaveLength(1);
  });

  it('renders the empty state (no chart) for an empty axis — no fake 0 line', () => {
    render(<TrackingSeriesChart axis={[]} total={[]} members={[]} />);
    expect(screen.getByText('尚無時序資料')).toBeInTheDocument();
    expect(chart.configs).toHaveLength(0);
  });

  it('destroys the chart on unmount', () => {
    const { unmount } = render(<TrackingSeriesChart axis={AXIS} total={TOTAL} members={MEMBERS} />);
    unmount();
    expect(chart.destroys.count).toBeGreaterThanOrEqual(1);
  });
});
