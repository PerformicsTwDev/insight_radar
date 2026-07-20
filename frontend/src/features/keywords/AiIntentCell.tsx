import type { ReactElement } from 'react';
import type { AiCellState } from '../../lib/aiCellState';
import { useAiIntentCell } from './useAiIntentCell';
import { useAiIntentBatchContext } from './aiIntentBatchContext';

/**
 * ✦ on-demand AI-intent cell (T4.1 single / T4.2 batch, FR-18; TC-28 / AC-18.1).
 * The grand-table's ✦ column renders one per row. Presentational rendering lives in
 * {@link AiIntentCellView} (idle → masked ✦ button, loading → spinner, done → the
 * summary, error → a distinct mark), reused by both the single-cell path and the
 * batch. When the table provides a batch coordinator (an `analysisId` is present),
 * this cell reads its state from the shared batch map keyed on `normalizedText` — so
 * the column-header batch and a single click drive one source of truth; otherwise it
 * falls back to its own single-cell hook (T4.1 standalone behaviour, unchanged).
 * Generating a cell drives **only** its own state — it never unlocks the left-side
 * dimension views (C13 gate decoupling). Tokens only — no hardcoded hex.
 */
export interface AiIntentCellProps {
  readonly analysisId: string;
  /**
   * The row's `normalizedText` (the C7 dedup/cache key the backend keys the summary
   * on). Optional because the current keyword list DTO doesn't emit it yet
   * (documented cross-spec gap) — when absent, generation returns 400 (AC-31.2) and
   * the cell shows the `invalid` mark (the standalone single-cell path handles it).
   */
  readonly normalizedText?: string;
}

const CELL_LABEL = 'AI 歸納搜尋意圖';
/** Distinct from {@link CELL_LABEL} so per-cell and batch triggers never collide by name. */
const BATCH_LABEL = '批次生成 AI 歸納搜尋意圖';

/**
 * Presentational ✦ cell over an {@link AiCellState} + a generate/retry handler.
 * Pure of any data source — fed either by the single-cell hook or the batch
 * coordinator — so the four render branches are covered once and reused by both.
 */
export function AiIntentCellView({
  state,
  onGenerate,
}: {
  readonly state: AiCellState;
  readonly onGenerate: () => void;
}): ReactElement {
  switch (state.status) {
    case 'idle':
      return (
        <button
          type="button"
          onClick={onGenerate}
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
          onClick={onGenerate}
          aria-label="AI 歸納失敗，重試"
          className="rounded px-1 text-xs text-trend-negative hover:underline"
        >
          ↺ 重試
        </button>
      );
  }
}

/** Standalone single-cell composition (T4.1): owns its own state via `useAiIntentCell`. */
function StandaloneAiIntentCell({ analysisId, normalizedText }: AiIntentCellProps): ReactElement {
  const { state, generate } = useAiIntentCell(analysisId, normalizedText);
  return <AiIntentCellView state={state} onGenerate={() => void generate()} />;
}

export function AiIntentCell({ analysisId, normalizedText }: AiIntentCellProps): ReactElement {
  const batch = useAiIntentBatchContext();
  // With a coordinator AND a real key, read/write the shared batch map (so the
  // column-header batch and single clicks stay one source of truth). Without a key,
  // fall back to the standalone path — a `normalizedText`-less row can't be a Map
  // entry (many such rows would collide on one bucket), and the single path already
  // surfaces its 400 `invalid` mark.
  if (batch && normalizedText) {
    return (
      <AiIntentCellView
        state={batch.cellStateFor(normalizedText)}
        onGenerate={() => void batch.generateOne(normalizedText)}
      />
    );
  }
  return <StandaloneAiIntentCell analysisId={analysisId} normalizedText={normalizedText} />;
}

/**
 * The ✦ column header (T4.2, FR-18 / AC-18.1). With a batch coordinator it is a
 * whole-column trigger: idle → a ✦ batch-generate button, running → a spinner,
 * done → a filled ✦, error → a retry. Its accessible name ({@link BATCH_LABEL}) is
 * deliberately distinct from the per-cell {@link CELL_LABEL}. Without a coordinator
 * (no `analysisId` context) it stays a masked ✦ placeholder — unchanged from T4.1.
 */
export function AiIntentBatchHeader(): ReactElement {
  const batch = useAiIntentBatchContext();
  if (!batch) return <span className="text-white/30">✦</span>;

  switch (batch.job) {
    case 'running':
      return (
        <span role="status" aria-label="批次生成中" className="animate-pulse text-brand">
          ✦
        </span>
      );
    case 'done':
      return (
        <span title="已生成搜尋意圖" className="text-brand">
          ✦
        </span>
      );
    case 'error':
      return (
        <button
          type="button"
          onClick={() => void batch.startBatch()}
          aria-label="批次生成失敗，重試"
          className="rounded px-1 text-xs text-trend-negative hover:underline"
        >
          ↺
        </button>
      );
    case 'idle':
      return (
        <button
          type="button"
          onClick={() => void batch.startBatch()}
          aria-label={BATCH_LABEL}
          title={BATCH_LABEL}
          className="rounded px-1 text-white/30 transition-colors hover:text-brand"
        >
          ✦
        </button>
      );
  }
}
