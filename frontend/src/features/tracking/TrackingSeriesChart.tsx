import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Chart, registerables } from 'chart.js';
import { assembleVolumeChart, type VolumeMemberInput } from '../../lib/volumeSeries';
import { TRACKING_AGGREGATE, TRACKING_MEMBER_PALETTE } from './trackingSeriesPalette';

/**
 * Tracking-volume line chart (T5.6, FR-19 → backend FR-30 / Design §9.2). Default
 * aggregate line (brand green, area fill) from the series `axis` + `total`; a "篩選成員"
 * popover multi-select adds one **`fetchedAt`-axis-aligned** line per member (member line
 * breaks at a missing observation — null, never 0). THIN component: every data transform
 * lives in the pure `lib/volumeSeries` (tested there, C11 + AC-30.2/30.3); jsdom can't
 * render canvas, so the component test mocks `chart.js` and asserts the assembled
 * datasets. An empty axis (first run / none in range) shows "尚無時序資料" and draws
 * NOTHING — never a fabricated 0 line (AC-30.3).
 */

// Tree-shakeable Chart.js v4 requires registering controllers/scales/elements once.
Chart.register(...registerables);

export interface TrackingSeriesChartProps {
  readonly axis: readonly string[];
  readonly total: readonly number[];
  readonly members: readonly VolumeMemberInput[];
}

export function TrackingSeriesChart({
  axis,
  total,
  members,
}: TrackingSeriesChartProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [popoverOpen, setPopoverOpen] = useState(false);

  const selectedMembers = useMemo(
    () => members.filter((member) => selected.has(member.key)),
    [members, selected],
  );

  const chartData = useMemo(
    () =>
      assembleVolumeChart({
        axis,
        total,
        members: selectedMembers,
        palette: TRACKING_MEMBER_PALETTE,
        aggregate: TRACKING_AGGREGATE,
      }),
    [axis, total, selectedMembers],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || chartData.isEmpty) {
      return;
    }
    const instance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: [...chartData.labels],
        datasets: chartData.datasets.map((dataset) => ({
          label: dataset.label,
          data: [...dataset.data],
          borderColor: dataset.borderColor,
          backgroundColor: dataset.backgroundColor,
          fill: dataset.fill,
          // a missing observation is a genuine break in the line (AC-30.2), never a 0.
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
        plugins: { legend: { display: true, labels: { color: 'rgba(255,255,255,0.8)' } } },
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
    return () => instance.destroy();
  }, [chartData]);

  const toggleMember = (key: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  if (chartData.isEmpty) {
    // 空/首次未跑（AC-30.3）：不畫假 0 線，只顯示可辨識空態。
    return (
      <section className="rounded-xl bg-bg-card p-4 ring-1 ring-white/10" aria-label="搜量時序">
        <h2 className="mb-3 text-sm font-medium text-white/80">搜量時序</h2>
        <p role="status" className="py-16 text-center text-sm text-white/40">
          尚無時序資料
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-bg-card p-4 ring-1 ring-white/10" aria-label="搜量時序">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-white/80">搜量時序</h2>
        <div className="relative">
          <button
            type="button"
            onClick={() => setPopoverOpen((open) => !open)}
            aria-haspopup="true"
            aria-expanded={popoverOpen}
            className="rounded-lg bg-bg-input px-3 py-1.5 text-xs text-white/80 ring-1 ring-white/10 hover:bg-bg-raised"
          >
            篩選成員
          </button>
          {popoverOpen && (
            <div
              role="group"
              aria-label="篩選成員"
              className="absolute right-0 z-20 mt-2 max-h-64 w-56 overflow-auto rounded-lg bg-bg-raised p-2 shadow-lg ring-1 ring-white/10"
            >
              {members.length === 0 ? (
                <p className="px-2 py-1 text-xs text-white/40">尚無可選成員</p>
              ) : (
                members.map((member) => (
                  <label
                    key={member.key}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-white/80 hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(member.key)}
                      onChange={() => toggleMember(member.key)}
                      className="accent-brand"
                    />
                    <span className="truncate">{member.label}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      <div className="relative h-72">
        <canvas ref={canvasRef} role="img" aria-label="搜量時序折線圖" />
      </div>
    </section>
  );
}
