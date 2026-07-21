/**
 * Pure error → display-state classifier (T6.1, FR-11; TC-22). **No React / no IO**
 * → core `src/lib/**` (≥90% coverage gate). The single point that decides, from a
 * backend `ErrorResponse` (`{ statusCode, code?, message?, fields? }`, backend
 * Design §4), WHICH state the UI shows and with WHAT (safe) message.
 *
 * Security single-point (NFR-5): a **5xx never surfaces the backend
 * message/stack** — only a curated generic string (no internal-detail leak). And
 * `ErrorResponse.fields` are surfaced **only** for a validation failure (the TC-36
 * inline field-error seam, reused by `createAnalysisForm.mapFieldErrors`), never
 * carried through a 5xx.
 *
 * A **401** is flagged `handledByInterceptor` because the auth middleware
 * (`api/authInterceptor`) already redirects to /login on a global 401; a view must
 * not paint a scary error over a session-expiry redirect.
 */

// STUB (T6.1 red): typed not-implemented shell — real classification lands green.

/** The minimal `ErrorResponse` shape this classifier reads (structural — no api-layer import). */
export interface ErrorResponseLike {
  readonly statusCode?: number;
  readonly code?: string;
  readonly message?: string | string[];
  readonly fields?: Record<string, string[]>;
}

/** The display category a backend failure maps to (drives which state element renders). */
export type ErrorStateKind =
  'unauthorized' | 'forbidden' | 'notFound' | 'validation' | 'conflict' | 'server' | 'unknown';

/** The safe, view-agnostic decision the state matrix renders from. */
export interface MappedError {
  readonly kind: ErrorStateKind;
  /** Safe, user-facing message — NEVER a raw 5xx message/stack. */
  readonly message: string;
  /** Whether an error+retry affordance makes sense (transient failure). */
  readonly retryable: boolean;
  /** True for 401 — the auth interceptor owns the /login redirect. */
  readonly handledByInterceptor: boolean;
  /** Inline field errors — present only for a validation failure that carries them. */
  readonly fields?: Record<string, string[]>;
}

export function mapErrorResponse(_status: number, _error?: ErrorResponseLike): MappedError {
  return { kind: 'unknown', message: '', retryable: false, handledByInterceptor: false };
}
