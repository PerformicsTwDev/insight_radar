import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Chart, registerables } from 'chart.js';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { assembleTrendDatasets, type KeywordSeriesInput } from '../../lib/trendSeries';
import { TREND_AGGREGATE, TREND_PALETTE } from './trendPalette';
import { handleExternalTooltip } from './trendTooltip';

/**
 * Trend line chart (T2.4, FR-5). Default aggregate line (brand green, area fill)
 * from the trend view's `axis` + `total`; a "篩選搜尋詞" popover multi-select adds
 * one axis-aligned line per keyword (10-colour cycle) with an external HTML
 * tooltip for the multi-line case. THIN component: **every data transform lives in
 * the pure `lib/trendSeries`** (tested there, C10/C12); jsdom can't render canvas,
 * so the component test mocks `chart.js` and asserts the assembled datasets.
 */

// Tree-shakeable Chart.js v4 requires registering controllers/scales/elements once.
Chart.register(...registerables);

export interface TrendChartProps {
  readonly axis: readonly string[];
  readonly total: readonly number[];
  readonly keywords: readonly KeywordSeriesInput[];
}

export function TrendChart({ axis, total, keywords }: TrendChartProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [popoverOpen, setPopoverOpen] = useState(false);
  // Click away closes the 篩選搜尋詞 popover (M7-R3, shared with the filter chips — R9 hook).
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useOutsideClick<HTMLDivElement>(
    popoverOpen,
    () => setPopoverOpen(false),
    triggerRef,
  );

  const selectedKeywords = useMemo(
    () => keywords.filter((keyword) => selected.has(keyword.keyword)),
    [keywords, selected],
  );

  const chartData = useMemo(
    () =>
      assembleTrendDatasets({
        axis,
        total,
        keywords: selectedKeywords,
        palette: TREND_PALETTE,
        aggregate: TREND_AGGREGATE,
      }),
    [axis, total, selectedKeywords],
  );

  const hasData = axis.length > 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasData) {
      return;
    }
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: [...chartData.labels],
        datasets: chartData.datasets.map((dataset) => ({
          label: dataset.label,
          data: [...dataset.data],
          borderColor: dataset.borderColor,
          backgroundColor: dataset.backgroundColor,
          fill: dataset.fill,
          // a null month is a genuine break in the line (C12), never bridged to a 0.
          spanGaps: false,
          tension: 0.3,
          pointRadius: 2,
          borderWidth: 2,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { color: 'rgba(255,255,255,0.8)' } },
          // multi-line uses an external HTML tooltip (FR-5 / AC-5.1); native disabled.
          tooltip: { enabled: false, external: handleExternalTooltip },
        },
        scales: {
          x: {
            ticks: { color: 'rgba(255,255,255,0.6)' },
            grid: { color: 'rgba(255,255,255,0.08)' },
          },
          y: {
            beginAtZero: true,
            ticks: { color: 'rgba(255,255,255,0.6)' },
            grid: { color: 'rgba(255,255,255,0.08)' },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [chartData, hasData]);

  const toggleKeyword = (keyword: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) {
        next.delete(keyword);
      } else {
        next.add(keyword);
      }
      return next;
    });

  if (!hasData) {
    return (
      <section
        className="flex min-h-[16rem] flex-col rounded-xl bg-bg-card p-4 ring-1 ring-white/10"
        aria-label="搜尋趨勢"
      >
        <h2 className="mb-3 text-sm font-medium text-white/80">搜尋趨勢</h2>
        <p role="status" className="flex flex-1 items-center justify-center text-sm text-white/40">
          尚無趨勢資料
        </p>
      </section>
    );
  }

  return (
    <section
      className="flex min-h-[16rem] flex-col rounded-xl bg-bg-card p-4 ring-1 ring-white/10"
      aria-label="搜尋趨勢"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-white/80">搜尋趨勢</h2>
        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setPopoverOpen((open) => !open)}
            aria-haspopup="true"
            aria-expanded={popoverOpen}
            className="flex items-center gap-1.5 rounded-lg bg-bg-input px-3 py-1.5 text-xs text-white/80 ring-1 ring-white/10 hover:bg-bg-raised"
          >
            <span>篩選搜尋詞</span>
            {selected.size > 0 ? (
              <span className="rounded-full bg-brand/20 px-1.5 text-[11px] font-medium text-brand">
                加總 {selected.size}
              </span>
            ) : null}
          </button>
          {popoverOpen && (
            <div
              ref={popoverRef}
              role="group"
              aria-label="篩選搜尋詞"
              className="absolute right-0 z-20 mt-2 max-h-64 w-56 overflow-auto rounded-lg bg-bg-raised p-2 shadow-lg ring-1 ring-white/10"
            >
              {keywords.length === 0 ? (
                <p className="px-2 py-1 text-xs text-white/40">尚無可選搜尋詞</p>
              ) : (
                keywords.map((keyword) => (
                  <label
                    key={keyword.keyword}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-white/80 hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(keyword.keyword)}
                      onChange={() => toggleKeyword(keyword.keyword)}
                      className="accent-brand"
                    />
                    <span className="truncate">{keyword.keyword}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      <div className="relative h-48">
        <canvas ref={canvasRef} role="img" aria-label="搜尋趨勢折線圖" />
      </div>
    </section>
  );
}
