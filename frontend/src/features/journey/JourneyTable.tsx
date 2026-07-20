import type { ReactElement } from 'react';
import { EM_DASH, formatVolume } from '../../lib/keywordsTable';
import { resolveJourneyStage } from '../../lib/journeyStages';

/**
 * 購買歷程表 (T4.4, FR-15; TC-25 表格). One row per keyword — 首欄帶**步驟號 badge**
 * (1→7) derived from the stage's ordinal, 階段 shown as its 中文 label via the
 * {@link resolveJourneyStage} SSOT (7 階段 enum↔zh 鎖死映射, C-class), 月均搜量 via
 * `formatVolume` (null → — , never 0, C12). Unclassified / unknown stage → 步驟 +
 * 階段 both — (no fabricated step). Rows come from `POST /query {view:'journey'}`
 * (`Record<string, unknown>[]`), so values are defensively coerced. Tokens only.
 */
export function JourneyTable({
  rows,
}: {
  rows: readonly Record<string, unknown>[] | undefined;
}): ReactElement {
  const data = rows ?? [];

  if (data.length === 0) {
    return (
      <p
        role="status"
        className="rounded-lg border border-white/10 bg-bg-card p-8 text-center text-sm text-white/50"
      >
        尚無購買歷程資料
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl bg-bg-card ring-1 ring-white/10">
      <table aria-label="購買歷程表" className="w-full border-collapse text-sm text-white/80">
        <thead className="bg-bg-raised text-xs text-white/60">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              步驟
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              關鍵字
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              購買歷程階段
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              月均搜量
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => {
            const stage = resolveJourneyStage(row.stage);
            return (
              <tr key={index} className="border-t border-white/5">
                <td className="px-3 py-2">
                  {stage.known ? (
                    <StepBadge step={stage.step} />
                  ) : (
                    <span className="text-white/40">{EM_DASH}</span>
                  )}
                </td>
                <td className="px-3 py-2 font-medium text-white">{asText(row.text)}</td>
                <td className="px-3 py-2">
                  {stage.known ? stage.label : <span className="text-white/40">{EM_DASH}</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatVolume(asNumberOrNull(row.avgMonthlySearches))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 步驟號 badge (1→7) — the stage's ordinal in the linear journey. */
function StepBadge({ step }: { step: number }): ReactElement {
  return (
    <span
      aria-label={`步驟 ${step}`}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand ring-1 ring-brand/30"
    >
      {step}
    </span>
  );
}

/** Coerce an untyped row cell to a display string (missing / non-string → — , C12). */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : EM_DASH;
}

/** Coerce an untyped row cell to `number | null` for `formatVolume` (non-number → null, C12). */
function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
