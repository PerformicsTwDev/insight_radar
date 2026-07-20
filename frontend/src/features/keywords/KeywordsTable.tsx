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
const COL_WIDTH = {
  text: 220,
  intent: 200,
  volume: 120,
  competition: 150,
  cpc: 170,
  trend: 128,
  ai: 72,
};

/**
 * Column model. The ✦ on-demand column binds to `analysisId`: when provided, each
 * cell is an interactive {@link AiIntentCell} (single-cell `POST :id/ai-intent-summary`,
 * T4.1/FR-18) keyed on the row's `normalizedText`; when absent (no analysis context —
 * e.g. a standalone/degraded render) it stays a masked ✦ placeholder. Built via a
 * factory so the ✦ cell can close over `analysisId` without a global table-meta
 * augmentation.
 */
function buildColumns(analysisId?: string): ColumnDef<KeywordRow>[] {
  return [
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
      header: '意圖',
      size: COL_WIDTH.intent,
      cell: ({ row }) => <IntentCell labels={row.original.intentLabels} />,
    },
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
      id: 'trend',
      header: '搜尋趨勢',
      size: COL_WIDTH.trend,
      // 搜尋趨勢 sparkline from each row's monthlyVolumes (FR-4 → FR-21); null months break, never 0.
      cell: ({ row }) => <SparklineCell volumes={row.original.monthlyVolumes} />,
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

/** The first column (搜尋詞) is frozen: sticky-left with an opaque bg so it stays put. */
function frozen(index: number, base: string, bg: string): string {
  return index === 0 ? `${base} sticky left-0 z-10 ${bg}` : base;
}

export function KeywordsTable({
  rows,
  analysisId,
  eventSourceFactory,
}: {
  rows: KeywordRow[];
  /** Analysis context enabling the interactive ✦ on-demand cells (T4.1, FR-18); omit for a masked ✦. */
  analysisId?: string;
  /** Injected SSE factory for the ✦ column-header batch (T4.2); prod uses the default. */
  eventSourceFactory?: EventSourceFactory;
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = useMemo(() => buildColumns(analysisId), [analysisId]);

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
          className={frozen(index, CELL_BASE, 'bg-bg-card')}
          style={{ width: cell.column.getSize() }}
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
      className="max-h-[600px] overflow-auto rounded-xl bg-bg-card ring-1 ring-white/10"
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
                  className={frozen(index, HEADER_BASE, 'bg-bg-raised')}
                  style={{ width: header.getSize() }}
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
