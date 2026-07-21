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

/** Curated, safe messages per kind — the ONLY strings a mapped error ever renders. */
const MESSAGES: Readonly<Record<ErrorStateKind, string>> = {
  unauthorized: '登入狀態已失效，請重新登入。',
  forbidden: '你沒有存取這項資料的權限。',
  notFound: '找不到資料，可能已被刪除或你沒有存取權限。',
  validation: '輸入內容有誤，請檢查後再試。',
  conflict: '操作發生衝突，請重新整理後再試。',
  server: '伺服器發生錯誤，請稍後再試。',
  unknown: '發生未預期的錯誤，請稍後再試。',
};

/** Map an HTTP status to its display kind (the one place the status→category rule lives). */
function kindForStatus(status: number): ErrorStateKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  if (status >= 500) return 'server';
  return 'unknown';
}

/**
 * Classify a backend failure into a safe display decision. The message is ALWAYS a
 * curated generic string (never `error.message`) so a 5xx cannot leak a stack or
 * internal detail (NFR-5); `error.fields` is surfaced ONLY for a validation
 * failure that actually carries field errors (the TC-36 inline seam).
 */
export function mapErrorResponse(status: number, error?: ErrorResponseLike): MappedError {
  const kind = kindForStatus(status);
  const retryable = kind === 'server' || kind === 'unknown';
  const handledByInterceptor = kind === 'unauthorized';
  const fields =
    kind === 'validation' && error?.fields && Object.keys(error.fields).length > 0
      ? error.fields
      : undefined;
  return { kind, message: MESSAGES[kind], retryable, handledByInterceptor, fields };
}
