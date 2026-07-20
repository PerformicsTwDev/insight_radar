import type { ReactElement } from 'react';

/**
 * ✦ on-demand AI-intent cell (T4.1, FR-18; TC-28 / AC-18.1). The grand-table's ✦
 * column renders one of these per row. Presentational over {@link useAiIntentCell}:
 * `idle` → a masked ✦ button, `loading` → a spinner, `done` → the AI-summarised
 * intent, `error` → a distinct mark (缺 normalizedText → 400 `invalid`, else a
 * retryable failure). Generating a cell drives **only** its own state — it never
 * unlocks the left-side dimension views (C13 gate decoupling). Tokens only.
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

export function AiIntentCell(_props: AiIntentCellProps): ReactElement {
  // RED stub — static masked placeholder (no state machine yet).
  return <span className="text-white/30">✦</span>;
}
