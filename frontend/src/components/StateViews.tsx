import type { ReactElement, ReactNode } from 'react';
import { mapErrorResponse, type ErrorResponseLike } from '../lib/errorState';

/**
 * Unified async-state matrix components (T6.1, FR-11; TC-22). The single-point set
 * every dashboard view renders its non-content states through, replacing the
 * per-view scattered skeleton/empty/error markup: `LoadingState` (skeleton),
 * `EmptyState` (empty), `ErrorState` (error + optional retry). The fourth state —
 * `gate` (not-ready) — reuses the existing {@link FeatureGate} overlay (T3.2), so
 * it is deliberately NOT re-implemented here.
 *
 * `ErrorState` is the security boundary: given a raw backend `error` it derives a
 * SAFE message via {@link mapErrorResponse} (a 5xx never leaks the stack/detail,
 * NFR-5); a call-site may instead pass an explicit curated `message`. Tokens only.
 */

const LOADING_CLASS = 'text-sm text-white/60';
// white/60 (not /40): the shared empty-state copy is real content and must clear
// WCAG AA — white/40 was only ~3.6:1 on bg-card, white/60 is ~6:1 (NFR-7 / TC-24).
const EMPTY_CLASS = 'text-sm text-white/60';
const ERROR_CLASS = 'text-sm text-trend-negative';
const RETRY_CLASS =
  'self-start rounded-lg border border-white/20 px-3 py-1 text-xs text-white hover:bg-white/5';

export interface LoadingStateProps {
  /** Loading copy (per-view override, e.g. 「洞察生成中…」). */
  readonly label?: string;
  /** Override the element className to preserve a call-site's exact look. */
  readonly className?: string;
}

export function LoadingState({
  label = '載入中…',
  className = LOADING_CLASS,
}: LoadingStateProps): ReactElement {
  return (
    <p role="status" className={className}>
      {label}
    </p>
  );
}

export interface EmptyStateProps {
  /** The empty-state message (ignored when `children` is given). */
  readonly message?: string;
  /** Rich empty content (takes precedence over `message`). */
  readonly children?: ReactNode;
  readonly className?: string;
}

export function EmptyState({
  message,
  children,
  className = EMPTY_CLASS,
}: EmptyStateProps): ReactElement {
  return <p className={className}>{children ?? message}</p>;
}

export interface ErrorStateProps {
  /** Explicit, curated view-specific message (takes precedence over `error`). */
  readonly message?: string;
  /** Raw backend error → a SAFE message via {@link mapErrorResponse} (5xx never leaks). */
  readonly error?: ErrorResponseLike;
  /** When provided, renders a retry affordance (the error+retry state). */
  readonly onRetry?: () => void;
  /** Retry button label (default 「重試」). */
  readonly retryLabel?: string;
  /** Override the message element className to preserve a call-site's exact look. */
  readonly className?: string;
}

export function ErrorState({
  message,
  error,
  onRetry,
  retryLabel = '重試',
  className = ERROR_CLASS,
}: ErrorStateProps): ReactElement {
  // Precedence: an explicit curated message, else a SAFE message derived from the
  // raw error (a 5xx never leaks — mapErrorResponse returns a generic string), else
  // a generic fallback (`mapErrorResponse(0)` → 'unknown').
  const resolved = message ?? mapErrorResponse(error?.statusCode ?? 0, error).message;

  // No retry → the plain inline alert (DOM-identical to the prior scattered
  // `<p role="alert" className=…>` mutation-error banners; behaviour conserved).
  if (!onRetry) {
    return (
      <p role="alert" className={className}>
        {resolved}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p role="alert" className={className}>
        {resolved}
      </p>
      <button type="button" onClick={onRetry} className={RETRY_CLASS}>
        {retryLabel}
      </button>
    </div>
  );
}
