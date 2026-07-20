import type { ReactElement } from 'react';
import { useAiIntentCell } from './useAiIntentCell';

/**
 * ✦ on-demand AI-intent cell (T4.1, FR-18; TC-28 / AC-18.1). The grand-table's ✦
 * column renders one of these per row. Presentational over {@link useAiIntentCell}:
 * `idle` → a masked ✦ button, `loading` → a spinner, `done` → the AI-summarised
 * intent, `error` → a distinct mark (缺 normalizedText → 400 `invalid` = a
 * non-retryable "缺少關鍵字資料"; anything else → a retryable failure). Generating a
 * cell drives **only** its own state — it never unlocks the left-side dimension
 * views (C13 gate decoupling). Tokens only — no hardcoded hex.
 */
export interface AiIntentCellProps {
  readonly analysisId: string;
  /**
   * The row's `normalizedText` (the C7 dedup/cache key the backend keys the summary
   * on). Optional because the current keyword list DTO doesn't emit it yet
   * (documented cross-spec gap) — when absent, generation returns 400 (AC-31.2) and
   * the cell shows the `invalid` mark.
   */
  readonly normalizedText?: string;
}

const CELL_LABEL = 'AI 歸納搜尋意圖';

export function AiIntentCell({ analysisId, normalizedText }: AiIntentCellProps): ReactElement {
  const { state, generate } = useAiIntentCell(analysisId, normalizedText);

  switch (state.status) {
    case 'idle':
      return (
        <button
          type="button"
          onClick={() => void generate()}
          aria-label={CELL_LABEL}
          title={CELL_LABEL}
          className="rounded px-1 text-white/30 transition-colors hover:text-brand"
        >
          ✦
        </button>
      );
    case 'loading':
      return (
        <span role="status" aria-label="AI 歸納中" className="animate-pulse text-brand">
          ✦
        </span>
      );
    case 'done':
      // `done` guarantees a non-null summary (discriminated AiCellState), so the
      // title needs no fallback.
      return (
        <span className="truncate text-xs text-white/80" title={state.summary}>
          {state.summary}
        </span>
      );
    case 'error':
      // 400 (缺 normalizedText, AC-31.2) is structural — a retry can't supply the key,
      // so surface a distinct non-retryable mark rather than the generic retry.
      if (state.errorKind === 'invalid') {
        return (
          <span role="status" title="缺少關鍵字資料，無法生成搜尋意圖摘要" className="text-warn">
            ⚠<span className="sr-only">缺少關鍵字資料，無法生成搜尋意圖摘要</span>
          </span>
        );
      }
      return (
        <button
          type="button"
          onClick={() => void generate()}
          aria-label="AI 歸納失敗，重試"
          className="rounded px-1 text-xs text-trend-negative hover:underline"
        >
          ↺ 重試
        </button>
      );
  }
}
