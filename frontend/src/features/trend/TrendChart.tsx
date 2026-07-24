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
  // 篩選搜尋詞 popover search box (v4, M7-R17): filters the selectable keyword list.
  const [search, setSearch] = useState('');
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

  // 全選 / 清除 (v4): select every keyword currently in the (search-filtered) list, or clear all.
  const filteredKeywords = useMemo(
    () => keywords.filter((k) => k.keyword.toLowerCase().includes(search.trim().toLowerCase())),
    [keywords, search],
  );
  const setAll = (on: boolean): void =>
    setSelected(on ? new Set(filteredKeywords.map((k) => k.keyword)) : new Set());

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
            className="inline-flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.035] px-3 py-[7px] text-[12.5px] font-semibold text-white/[0.66] transition hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-white/90"
          >
            {/* v4 trend chip uses the line-chart filter icon. */}
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 17l6-6 4 4 8-8" />
              <path d="M17 7h4v4" />
            </svg>
            <span>篩選搜尋詞</span>
            <span className="text-brand">
              {selected.size > 0 ? `已選 ${selected.size}` : '加總趨勢'}
            </span>
          </button>
          {popoverOpen && (
            <div
              ref={popoverRef}
              role="group"
              aria-label="篩選搜尋詞"
              className="absolute right-0 z-[70] mt-2 w-[300px] rounded-[14px] border border-white/10 bg-bg-body/[0.98] p-3 shadow-[0_18px_45px_rgba(0,0,0,0.45)] backdrop-blur-[14px]"
            >
              {/* v4 popover header: 選擇搜尋詞（可多選） + 全選 / 清除 (M7-R17, #7). */}
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/50">
                  選擇搜尋詞{' '}
                  <span className="font-normal normal-case tracking-normal text-white/35">
                    （可多選）
                  </span>
                </span>
                <div className="flex shrink-0 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setAll(true)}
                    className="text-xs font-bold text-brand transition hover:opacity-80"
                  >
                    全選
                  </button>
                  <button
                    type="button"
                    onClick={() => setAll(false)}
                    className="text-xs font-bold text-brand transition hover:opacity-80"
                  >
                    清除
                  </button>
                </div>
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋關鍵字…"
                aria-label="搜尋關鍵字"
                className="mb-2 w-full rounded-lg border border-white/10 bg-bg-input px-2.5 py-2 text-[12.5px] text-white outline-none focus:ring-1 focus:ring-brand"
              />
              <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                {filteredKeywords.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-white/40">
                    {keywords.length === 0 ? '尚無可選搜尋詞' : '無相符搜尋詞'}
                  </p>
                ) : (
                  filteredKeywords.map((keyword) => (
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
