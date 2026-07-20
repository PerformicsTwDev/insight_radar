import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { postQuery } from '../../api/query';
import { customViewName } from '../../lib/customView';
import { EM_DASH, formatVolume } from '../../lib/keywordsTable';

/**
 * 自訂分類表 (T5.2, FR-16; TC-42). Reads `POST /query {view:'custom:{cid}'}` (view-router;
 * custom has no dedicated content endpoint) and renders the returned columns + rows
 * **metadata-driven** — the columns come from the response, not hard-coded, so this is
 * the T3.1 view-registry integration point (a new backend column surfaces with no code
 * change here). A non-table body, an empty row set, or a fetch failure all fall back to
 * the empty state (never a half-parsed table). Cells are defensively coerced: numbers
 * group (null → — , never 0, C12), arrays join, anything missing → —. Tokens only.
 */
export interface CustomClassifyTableProps {
  readonly analysisId: string;
  readonly cid: string;
}

export function CustomClassifyTable({ analysisId, cid }: CustomClassifyTableProps): ReactElement {
  const query = useQuery({
    queryKey: ['custom-view', analysisId, cid],
    queryFn: () => postQuery(analysisId, { view: customViewName(cid) }),
  });
  const view = query.data?.ok && query.data.view.kind === 'table' ? query.data.view : undefined;

  if (!view || view.rows.length === 0) {
    return (
      <p
        role="status"
        className="rounded-lg border border-white/10 bg-bg-card p-8 text-center text-sm text-white/50"
      >
        尚無分類資料
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl bg-bg-card ring-1 ring-white/10">
      <table aria-label="自訂分類表" className="w-full border-collapse text-sm text-white/80">
        <thead className="bg-bg-raised text-xs text-white/60">
          <tr>
            {view.columns.map((col) => (
              <th key={col.key} scope="col" className="px-3 py-2 text-left font-medium">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row, index) => (
            <tr key={index} className="border-t border-white/5">
              {view.columns.map((col) => (
                <td key={col.key} className="px-3 py-2">
                  {formatCell(row[col.key], col.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Coerce an untyped row cell to a display string by its declared column type (C12). */
function formatCell(value: unknown, type: 'text' | 'number' | 'array'): string {
  if (type === 'number') return typeof value === 'number' ? formatVolume(value) : EM_DASH;
  if (type === 'array') return Array.isArray(value) ? value.join(', ') : EM_DASH;
  return typeof value === 'string' ? value : EM_DASH;
}
