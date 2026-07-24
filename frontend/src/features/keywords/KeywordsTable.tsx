import { useMemo, useRef, type CSSProperties, type ReactElement } from 'react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { config } from '../../config/env';
import type { KeywordRow } from '../../api/keywords';
import {
  EM_DASH,
  formatCompetition,
  formatCpcRange,
  formatVolume,
  resolveIntent,
  shouldVirtualize,
} from '../../lib/keywordsTable';
import { AiIntentBatchHeader, AiIntentCell } from './AiIntentCell';
import { SparklineCell } from './SparklineCell';
import {
  DimensionCell,
  DimensionHeader,
  type DimensionAccent,
  type DimensionCellState,
  type DimensionHeaderPhase,
} from './DimensionColumn';
import { AiIntentBatchContext } from './aiIntentBatchContext';
import { useAiIntentBatch } from './useAiIntentBatch';
import type { EventSourceFactory } from '../job/useJobTracking';

/**
 * Search-terms grand table (T2.1, FR-4). TanStack Table column model +
 * `@tanstack/react-virtual` row virtualization. The `搜尋詞` column is frozen
 * (sticky-left, narrow) with a sticky header; a page whose row count exceeds the
 * threshold (Design §14) is windowed, otherwise every row renders plainly. All
 * cell formatting is delegated to the pure `lib/keywordsTable` helpers so null
 * cells show `—` (C12), never 0. The ✦ on-demand column renders interactive
 * {@link AiIntentCell}s when an `analysisId` is supplied (single-cell AI-intent
 * summary, T4.1/FR-18), else a masked ✦ placeholder. Tokens only — no hardcoded hex.
 *
 * Presentational: driven entirely by the `rows` prop (the data hook — server
 * pagination / sort / filter / view-metadata columns — lands in T2.6 / T3.1).
 */

const ROW_HEIGHT = 44;
const SELECT_WIDTH = 44;
const COL_WIDTH = {
  text: 220,
  intent: 200,
  // On-demand dimension columns (搜尋意圖主題 / 購買歷程主題), M7-R2b/c.
  dimension: 132,
  volume: 120,
  competition: 150,
  cpc: 170,
  // Widened for the M7-R2a inline signed-% beside the sparkline (was 128, sparkline-only).
  trend: 168,
  ai: 72,
};

/**
 * One on-demand dimension column (M7-R2b/c, FR-18): 搜尋意圖主題 / 購買歷程主題. The container
 * (KeywordsView) supplies the header phase + generate handler (from useTopics / useJourney) and a
 * per-row cell state (from the `normalizedText` client-join); the table just renders it after 意圖.
 */
export interface DimensionColumnConfig {
  readonly id: string;
  readonly label: string;
  readonly accent: DimensionAccent;
  readonly phase: DimensionHeaderPhase;
  readonly onGenerate: () => void;
  readonly cellState: (row: KeywordRow) => DimensionCellState;
}

/**
 * Per-row selection wiring (T6.4, FR-19) — supplied by the route-mounted container
 * (KeywordsView) when an analysis (geo, language) context is known, so a picked row
 * carries its source context into the tracking-list bulk bar. Omitted for a
 * standalone / degraded render → no selection column (the pre-T6.4 table shape).
 */
export interface KeywordsTableSelection {
  /** Whether this row is currently in the selection set (keyed by normalizedText, C7). */
  readonly isSelected: (row: KeywordRow) => boolean;
  /** Toggle this row in/out of the selection set. */
  readonly onToggle: (row: KeywordRow) => void;
}

/**
 * Column model. The ✦ on-demand column binds to `analysisId`: when provided, each
 * cell is an interactive {@link AiIntentCell} (single-cell `POST :id/ai-intent-summary`,
 * T4.1/FR-18) keyed on the row's `normalizedText`; when absent (no analysis context —
 * e.g. a standalone/degraded render) it stays a masked ✦ placeholder. Built via a
 * factory so the ✦ cell can close over `analysisId` without a global table-meta
 * augmentation.
 */
function buildColumns(
  analysisId?: string,
  selection?: KeywordsTableSelection,
  dimensionColumns: readonly DimensionColumnConfig[] = [],
): ColumnDef<KeywordRow>[] {
  // The on-demand 搜尋意圖主題 / 購買歷程主題 columns sit right after 意圖 (v4 grouping); each binds
  // its container-supplied header phase + generate handler and per-row client-joined cell state.
  const dimensionCols: ColumnDef<KeywordRow>[] = dimensionColumns.map((dc) => ({
    id: dc.id,
    header: () => <DimensionHeader label={dc.label} phase={dc.phase} onGenerate={dc.onGenerate} />,
    size: COL_WIDTH.dimension,
    cell: ({ row }) => <DimensionCell state={dc.cellState(row.original)} accent={dc.accent} />,
  }));
  const selectColumn: ColumnDef<KeywordRow>[] = selection
    ? [
        {
          id: 'select',
          // Header stays a non-interactive spacer — a 全選 control is out of the FR-19
          // "pick rows" scope; screen readers get the per-row checkbox's own label.
          header: () => <span className="sr-only">選取</span>,
          size: SELECT_WIDTH,
          cell: ({ row }) => (
            <input
              type="checkbox"
              aria-label={`選取 ${row.original.text}`}
              checked={selection.isSelected(row.original)}
              onChange={() => selection.onToggle(row.original)}
              className="accent-brand"
            />
          ),
        },
      ]
    : [];
  return [
    ...selectColumn,
    {
      id: 'text',
      header: '搜尋詞',
      accessorKey: 'text',
      size: COL_WIDTH.text,
      cell: ({ row }) => (
        <span className="truncate font-medium text-white">{row.original.text}</span>
      ),
    },
    {
      id: 'intent',
      // v4 搜尋意圖類別 (M7-R17): the first of the 3 green ✦ AI columns. Unlike 搜尋意圖主題 /
      // 購買歷程主題 (on-demand, gated) this is the intent the backend always classifies (FR-4),
      // so it renders populated (its own IntentCell), not a generatable/shimmer dimension.
      header: () => (
        <span className="flex items-center gap-1 text-brand">
          搜尋意圖類別
          <span aria-hidden="true">✦</span>
        </span>
      ),
      size: COL_WIDTH.intent,
      cell: ({ row }) => <IntentCell labels={row.original.intentLabels} />,
    },
    ...dimensionCols,
    {
      id: 'avgMonthlySearches',
      header: '搜尋量',
      accessorKey: 'avgMonthlySearches',
      size: COL_WIDTH.volume,
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">
          {formatVolume(row.original.avgMonthlySearches)}
        </span>
      ),
    },
    {
      id: 'trend',
      header: '搜尋趨勢TTM',
      size: COL_WIDTH.trend,
      // v4 order: 搜尋趨勢TTM sits right after 搜尋量 (before 競爭度/CPC), M7-R2. sparkline + inline
      // signed % from each row's monthlyVolumes (FR-4 → FR-21, M7-R2a); null months break the line
      // (never 0), an unclassifiable % shows — inline.
      cell: ({ row }) => <SparklineCell volumes={row.original.monthlyVolumes} />,
    },
    {
      id: 'competition',
      header: '競爭度',
      size: COL_WIDTH.competition,
      cell: ({ row }) => (
        <span>{formatCompetition(row.original.competition, row.original.competitionIndex)}</span>
      ),
    },
    {
      id: 'cpc',
      header: 'CPC',
      size: COL_WIDTH.cpc,
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">
          {formatCpcRange(row.original.cpcLow, row.original.cpcHigh)}
        </span>
      ),
    },
    {
      id: 'ai',
      // ✦ header = the column-header batch trigger when a coordinator is mounted
      // (analysisId present), else a masked ✦ placeholder — driven by context (T4.2,
      // FR-18), so `buildColumns` needn't thread the coordinator through the factory.
      header: () => <AiIntentBatchHeader />,
      size: COL_WIDTH.ai,
      // ✦ on-demand AI-intent column (T4.1 single / T4.2 batch, FR-18): interactive
      // per-row cell when an analysis context is present, else a masked ✦ placeholder.
      cell: ({ row }) =>
        analysisId !== undefined ? (
          <AiIntentCell analysisId={analysisId} normalizedText={row.original.normalizedText} />
        ) : (
          <span className="text-white/30">✦</span>
        ),
    },
  ];
}

const HEADER_BASE =
  'flex shrink-0 items-center overflow-hidden px-3 py-2 text-xs font-medium text-white/60';
const CELL_BASE = 'flex shrink-0 items-center overflow-hidden px-3 py-2 text-sm text-white/80';

/**
 * The lead columns are frozen (sticky-left with an opaque bg so they stay put on
 * horizontal scroll): the 搜尋詞 column always, plus the selection column ahead of it
 * when present. `frozenCount` = how many lead columns freeze (2 with selection, else 1).
 * The base `left-0` pins the first frozen column; a following frozen column overrides it
 * with an inline left offset ({@link frozenLeft}) so both stay put without a purge-unsafe
 * dynamic Tailwind class.
 */
function frozenClass(index: number, frozenCount: number, base: string, bg: string): string {
  return index < frozenCount ? `${base} sticky left-0 z-10 ${bg}` : base;
}

/** Inline left offset (px) for a frozen column past the first — the 搜尋詞 column when a
 * selection column precedes it; `undefined` (no override) for the pinned first column. */
function frozenLeft(index: number, frozenCount: number): number | undefined {
  return frozenCount === 2 && index === 1 ? SELECT_WIDTH : undefined;
}

export function KeywordsTable({
  rows,
  analysisId,
  selection,
  dimensionColumns,
  eventSourceFactory,
}: {
  rows: KeywordRow[];
  /** Analysis context enabling the interactive ✦ on-demand cells (T4.1, FR-18); omit for a masked ✦. */
  analysisId?: string;
  /** Per-row selection wiring (T6.4, FR-19); omit → no selection column (pre-T6.4 shape). */
  selection?: KeywordsTableSelection;
  /** On-demand 搜尋意圖主題 / 購買歷程主題 columns (M7-R2b/c, FR-18); omit → none. */
  dimensionColumns?: readonly DimensionColumnConfig[];
  /** Injected SSE factory for the ✦ column-header batch (T4.2); prod uses the default. */
  eventSourceFactory?: EventSourceFactory;
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = useMemo(
    () => buildColumns(analysisId, selection, dimensionColumns),
    [analysisId, selection, dimensionColumns],
  );
  // Freeze the selection column (when present) plus 搜尋詞 (Design §6 C1 sticky lead).
  const frozenCount = selection ? 2 : 1;

  // The ✦ column-header batch coordinator (T4.2, FR-18): masks its target cells (the
  // rows that carry a normalizedText key) and fills them progressively over SSE. The
  // hook is always instantiated (Rules of Hooks) but is dormant until `startBatch`;
  // it is only exposed to the cells/header via context when an analysis is present.
  const batchKeys = useMemo(
    () => rows.map((r) => r.normalizedText).filter((k): k is string => Boolean(k)),
    [rows],
  );
  const batch = useAiIntentBatch(analysisId ?? '', batchKeys, { eventSourceFactory });
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  const tableRows = table.getRowModel().rows;
  const totalWidth = table.getTotalSize();
  const virtual = shouldVirtualize(rows.length, config.virtualRowThreshold);

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const renderRow = (row: (typeof tableRows)[number], style?: CSSProperties): ReactElement => (
    <div role="row" key={row.id} className="flex border-b border-white/5" style={style}>
      {row.getVisibleCells().map((cell, index) => (
        <div
          role="cell"
          key={cell.id}
          className={frozenClass(index, frozenCount, CELL_BASE, 'bg-bg-card')}
          style={{ width: cell.column.getSize(), left: frozenLeft(index, frozenCount) }}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </div>
      ))}
    </div>
  );

  const tableEl = (
    <div
      ref={scrollRef}
      role="table"
      aria-label="搜尋詞總表"
      aria-rowcount={rows.length}
      // M7-R4: fill the results row's remaining height (min-h-0 + flex-1) and scroll internally —
      // the virtualizer's scroll element — rather than a fixed 600px cap, so the 三欄 scroll
      // independently inside the fixed-height frame.
      className="min-h-0 flex-1 overflow-auto rounded-xl bg-bg-card ring-1 ring-white/10"
    >
      <div role="presentation" style={{ width: totalWidth, minWidth: '100%' }}>
        <div
          role="rowgroup"
          data-testid="keywords-thead"
          className="sticky top-0 z-20 bg-bg-raised"
        >
          {table.getHeaderGroups().map((group) => (
            <div role="row" key={group.id} className="flex">
              {group.headers.map((header, index) => (
                <div
                  role="columnheader"
                  key={header.id}
                  className={frozenClass(index, frozenCount, HEADER_BASE, 'bg-bg-raised')}
                  style={{ width: header.getSize(), left: frozenLeft(index, frozenCount) }}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div
          role="rowgroup"
          style={virtual ? { height: virtualizer.getTotalSize(), position: 'relative' } : undefined}
        >
          {virtual
            ? virtualizer.getVirtualItems().map((item) =>
                renderRow(tableRows[item.index], {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                }),
              )
            : tableRows.map((row) => renderRow(row))}
        </div>
      </div>
    </div>
  );

  // Expose the coordinator to the ✦ cells + header only with an analysis context; a
  // standalone/degraded render (no analysisId) keeps the masked ✦ placeholders.
  return analysisId !== undefined ? (
    <AiIntentBatchContext.Provider value={batch}>{tableEl}</AiIntentBatchContext.Provider>
  ) : (
    tableEl
  );
}

/** Intent chips via the intentMap SSOT (C2); empty list → — (never an empty cell). */
function IntentCell({ labels }: { labels: string[] }): ReactElement {
  if (labels.length === 0) {
    return <span className="text-white/40">{EM_DASH}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label) => {
        const { zh, color } = resolveIntent(label);
        // Color comes from the intentMap SSOT (C2) as a runtime value, so it is applied
        // inline rather than via a Tailwind token class — a label→color lookup can't be
        // JIT-safelisted into a static class without a safelist (do NOT "fix" this into a
        // dynamic className, which Tailwind would purge).
        return (
          <span
            key={label}
            className="rounded px-1.5 py-0.5 text-xs ring-1 ring-white/10"
            style={color ? { color } : undefined}
          >
            {zh}
          </span>
        );
      })}
    </div>
  );
}
