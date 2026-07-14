import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TC-16 (FR-5, Design §6 C10/C12) — the trend chart draws a default aggregate line
 * and, on multi-select, one axis-aligned line per keyword. jsdom cannot render a
 * `<canvas>`, so `chart.js` is mocked: we assert the **assembled datasets** handed
 * to Chart.js (aggregate first; per-keyword lines aligned to the shared axis with
 * null gaps), the popover selection wiring, and resource cleanup — not pixels.
 */

// Capture every Chart.js config across (re)constructions + count destroys.
const chart = vi.hoisted(() => ({
  configs: [] as unknown[],
  destroys: { count: 0 },
}));

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

import { TrendChart } from './TrendChart';
import {
  getTooltipEl,
  handleExternalTooltip,
  toTrendTooltipModel,
  updateTooltipEl,
  type TrendTooltipModel,
} from './trendTooltip';
import type { KeywordSeriesInput } from '../../lib/trendSeries';

interface Dataset {
  label: string;
  data: (number | null)[];
  fill: boolean;
  borderColor: string;
}
interface Config {
  data: { labels: string[]; datasets: Dataset[] };
}
const lastConfig = (): Config => chart.configs[chart.configs.length - 1] as Config;

const AXIS = ['2026-01', '2026-02', '2026-03'];
const TOTAL = [300, 250, 400];
const KEYWORDS: KeywordSeriesInput[] = [
  {
    keyword: 'running shoes',
    volumes: [
      { year: 2026, month: 1, searches: 100 },
      { year: 2026, month: 3, searches: 140 },
    ],
  },
  { keyword: 'trail shoes', volumes: [{ year: 2026, month: 2, searches: 50 }] },
];

beforeEach(() => {
  chart.configs.length = 0;
  chart.destroys.count = 0;
});

describe('TC-16 · TrendChart (aggregate line + axis-aligned multi-line)', () => {
  it('draws the aggregate line by default (single dataset, brand fill)', () => {
    render(<TrendChart axis={AXIS} total={TOTAL} keywords={KEYWORDS} />);
    const config = lastConfig();
    expect(config.data.labels).toEqual(AXIS);
    expect(config.data.datasets).toHaveLength(1);
    expect(config.data.datasets[0].label).toBe('全部搜尋詞加總');
    expect(config.data.datasets[0].data).toEqual([300, 250, 400]);
    expect(config.data.datasets[0].fill).toBe(true);
  });

  it('adds an axis-aligned line per selected keyword via the 篩選搜尋詞 popover', () => {
    render(<TrendChart axis={AXIS} total={TOTAL} keywords={KEYWORDS} />);

    fireEvent.click(screen.getByRole('button', { name: /篩選搜尋詞/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'running shoes' }));

    const config = lastConfig();
    expect(config.data.datasets).toHaveLength(2);
    // aggregate stays first; the keyword line is aligned to the SHARED axis with a
    // null gap for the month it lacks (Feb) — never re-derived, never 0 (C10 + C12).
    expect(config.data.datasets[0].label).toBe('全部搜尋詞加總');
    expect(config.data.datasets[1].label).toBe('running shoes');
    expect(config.data.datasets[1].data).toEqual([100, null, 140]);
    expect(config.data.datasets[1].fill).toBe(false);
    // recreating the chart destroys the prior instance (no leak).
    expect(chart.destroys.count).toBeGreaterThanOrEqual(1);
  });

  it('removes a keyword line when it is deselected', () => {
    render(<TrendChart axis={AXIS} total={TOTAL} keywords={KEYWORDS} />);

    fireEvent.click(screen.getByRole('button', { name: /篩選搜尋詞/ }));
    const checkbox = screen.getByRole('checkbox', { name: 'trail shoes' });
    fireEvent.click(checkbox);
    expect(lastConfig().data.datasets).toHaveLength(2);
    fireEvent.click(checkbox);
    expect(lastConfig().data.datasets).toHaveLength(1);
  });

  it('renders an empty state (no chart) when the axis is empty', () => {
    render(<TrendChart axis={[]} total={[]} keywords={[]} />);
    expect(screen.getByText('尚無趨勢資料')).toBeInTheDocument();
    expect(chart.configs).toHaveLength(0);
  });

  it('shows a no-selectable-terms hint when the popover opens with no keywords', () => {
    // axis present (chart draws) but no keyword rows to filter by.
    render(<TrendChart axis={AXIS} total={TOTAL} keywords={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /篩選搜尋詞/ }));
    expect(screen.getByText('尚無可選搜尋詞')).toBeInTheDocument();
    expect(lastConfig().data.datasets).toHaveLength(1);
  });

  it('destroys the chart on unmount', () => {
    const { unmount } = render(<TrendChart axis={AXIS} total={TOTAL} keywords={KEYWORDS} />);
    unmount();
    expect(chart.destroys.count).toBeGreaterThanOrEqual(1);
  });
});

describe('TC-16 · external HTML tooltip helpers (multi-line, null-safe)', () => {
  it('maps a Chart.js tooltip model to null-safe rows (— for null, C12)', () => {
    const model = toTrendTooltipModel({
      opacity: 1,
      title: ['2026-02'],
      dataPoints: [
        { dataset: { label: 'running shoes', borderColor: '#aaa' }, parsed: { y: 140 } },
        { dataset: { label: 'trail shoes', borderColor: '#bbb' }, parsed: { y: null } },
      ],
    });
    expect(model.visible).toBe(true);
    expect(model.title).toBe('2026-02');
    expect(model.rows).toEqual([
      { label: 'running shoes', value: '140', color: '#aaa' },
      { label: 'trail shoes', value: '—', color: '#bbb' },
    ]);
  });

  it('marks the model hidden when Chart.js reports opacity 0', () => {
    const model = toTrendTooltipModel({ opacity: 0, title: [], dataPoints: [] });
    expect(model.visible).toBe(false);
  });

  it('falls back safely for missing label / non-string colour / missing title / no points', () => {
    const model = toTrendTooltipModel({
      opacity: 1,
      // no title, dataset without label, borderColor a non-string (gradient), y not a number
      dataPoints: [{ dataset: { borderColor: { some: 'gradient' } }, parsed: {} }],
    });
    expect(model.title).toBe('');
    expect(model.rows).toEqual([{ label: '', value: '—', color: '' }]);
  });

  it('falls back to document.body for a canvas with no parent', () => {
    const canvas = document.createElement('canvas'); // detached (no parentElement)
    const el = getTooltipEl(canvas);
    expect(el.parentElement).toBe(document.body);
    el.remove();
  });

  it('treats a tooltip with no dataPoints as an empty row set', () => {
    const model = toTrendTooltipModel({ opacity: 1, title: ['2026-02'] });
    expect(model.rows).toEqual([]);
  });

  it('reuses one tooltip element per canvas parent (idempotent)', () => {
    const parent = document.createElement('div');
    const canvas = document.createElement('canvas');
    parent.appendChild(canvas);
    document.body.appendChild(parent);
    const first = getTooltipEl(canvas);
    const second = getTooltipEl(canvas);
    expect(first).toBe(second);
    expect(parent.querySelectorAll('[data-trend-tooltip]')).toHaveLength(1);
  });

  it('writes title + a swatch/label row per series, and hides on invisible', () => {
    const el = document.createElement('div');
    const visible: TrendTooltipModel = {
      visible: true,
      title: '2026-02',
      rows: [{ label: 'running shoes', value: '140', color: '#aaa' }],
    };
    updateTooltipEl(el, visible);
    expect(el.style.opacity).toBe('1');
    expect(el.textContent).toContain('2026-02');
    expect(el.textContent).toContain('running shoes: 140');

    updateTooltipEl(el, { visible: false, title: '', rows: [] });
    expect(el.style.opacity).toBe('0');
  });

  it('builds + positions the tooltip element from a Chart.js external context', () => {
    const parent = document.createElement('div');
    const canvas = document.createElement('canvas');
    parent.appendChild(canvas);
    document.body.appendChild(parent);

    handleExternalTooltip({
      chart: { canvas },
      tooltip: {
        opacity: 1,
        caretX: 20,
        caretY: 30,
        title: ['2026-02'],
        dataPoints: [
          { dataset: { label: 'running shoes', borderColor: '#aaa' }, parsed: { y: 140 } },
        ],
      },
    });

    const el = parent.querySelector<HTMLElement>('[data-trend-tooltip]');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('running shoes: 140');
    expect(el?.style.opacity).toBe('1');
    expect(el?.style.left).toBe('20px');
    expect(el?.style.top).toBe('30px');
  });

  it('defaults caret position to 0 when Chart.js omits it', () => {
    const parent = document.createElement('div');
    const canvas = document.createElement('canvas');
    parent.appendChild(canvas);
    document.body.appendChild(parent);

    handleExternalTooltip({ chart: { canvas }, tooltip: { opacity: 1, dataPoints: [] } });

    const el = parent.querySelector<HTMLElement>('[data-trend-tooltip]');
    expect(el?.style.left).toBe('0px');
    expect(el?.style.top).toBe('0px');
  });
});
