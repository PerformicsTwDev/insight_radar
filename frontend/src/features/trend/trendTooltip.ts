import { buildTooltipRows, type TooltipRow, type TrendTooltipPoint } from '../../lib/trendSeries';

/**
 * External HTML tooltip for the trend chart (T2.4, FR-5 / AC-5.1). Chart.js's native
 * canvas tooltip is disabled; the multi-line case renders a DOM tooltip instead.
 * These helpers do the DOM work (so they live beside the feature, not in pure
 * `lib/`), while value formatting stays in `lib/trendSeries` (`buildTooltipRows`,
 * null-safe — `—` for null, C12). Kept out of `TrendChart.tsx` so that file exports
 * only the component (react-refresh / fast-refresh boundary).
 */

/** Neutral tooltip view-model (decoupled from Chart.js), fed to {@link updateTooltipEl}. */
export interface TrendTooltipModel {
  readonly visible: boolean;
  readonly title: string;
  readonly rows: TooltipRow[];
}

/** Chart.js tooltip fields we read (structural — the real `TooltipModel<'line'>` is assignable). */
export interface RawTooltip {
  readonly opacity: number;
  readonly title?: readonly string[];
  readonly caretX?: number;
  readonly caretY?: number;
  readonly dataPoints?: readonly {
    readonly dataset: { readonly label?: string; readonly borderColor?: unknown };
    readonly parsed: { readonly y?: unknown };
  }[];
}

/** Chart.js `external` handler arg we read (structural — the real `{ chart, tooltip }` is assignable). */
export interface ExternalTooltipContext {
  readonly chart: { readonly canvas: HTMLCanvasElement };
  readonly tooltip: RawTooltip;
}

const TOOLTIP_ATTR = 'data-trend-tooltip';

/**
 * Get (or lazily create) the single external-tooltip element for a canvas, hung off
 * the canvas's parent so it positions relative to the chart. Idempotent per canvas.
 */
export function getTooltipEl(canvas: HTMLCanvasElement): HTMLElement {
  const parent = canvas.parentElement ?? document.body;
  const existing = parent.querySelector<HTMLElement>(`[${TOOLTIP_ATTR}]`);
  if (existing) {
    return existing;
  }
  const el = document.createElement('div');
  el.setAttribute(TOOLTIP_ATTR, '');
  el.className =
    'pointer-events-none absolute z-30 rounded-lg bg-bg-raised px-3 py-2 text-xs text-white shadow-lg ring-1 ring-white/10 transition-opacity';
  el.style.opacity = '0';
  parent.appendChild(el);
  return el;
}

/** Map a Chart.js tooltip model to a null-safe view-model (`—` for null values, C12). */
export function toTrendTooltipModel(tooltip: RawTooltip): TrendTooltipModel {
  const points: TrendTooltipPoint[] = (tooltip.dataPoints ?? []).map((point) => ({
    label: point.dataset.label ?? '',
    value: typeof point.parsed.y === 'number' ? point.parsed.y : null,
    color: typeof point.dataset.borderColor === 'string' ? point.dataset.borderColor : '',
  }));
  return {
    visible: tooltip.opacity !== 0,
    title: tooltip.title?.[0] ?? '',
    rows: buildTooltipRows(points),
  };
}

/** Render the tooltip view-model into an element (title + one swatch/label row per series). */
export function updateTooltipEl(el: HTMLElement, model: TrendTooltipModel): void {
  if (!model.visible) {
    el.style.opacity = '0';
    return;
  }
  el.style.opacity = '1';
  el.replaceChildren();

  const title = document.createElement('div');
  title.className = 'mb-1 font-medium text-white/70';
  title.textContent = model.title;
  el.appendChild(title);

  for (const row of model.rows) {
    const line = document.createElement('div');
    line.className = 'flex items-center gap-2';
    const swatch = document.createElement('span');
    swatch.className = 'inline-block h-2 w-2 rounded-full';
    swatch.style.backgroundColor = row.color;
    const label = document.createElement('span');
    label.className = 'font-mono tabular-nums';
    label.textContent = `${row.label}: ${row.value}`;
    line.append(swatch, label);
    el.appendChild(line);
  }
}

/** Chart.js `external` tooltip handler: build/position the HTML tooltip from the context. */
export function handleExternalTooltip(context: ExternalTooltipContext): void {
  const { canvas } = context.chart;
  const el = getTooltipEl(canvas);
  updateTooltipEl(el, toTrendTooltipModel(context.tooltip));
  el.style.left = `${canvas.offsetLeft + (context.tooltip.caretX ?? 0)}px`;
  el.style.top = `${canvas.offsetTop + (context.tooltip.caretY ?? 0)}px`;
}
