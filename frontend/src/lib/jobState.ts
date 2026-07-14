import { z } from 'zod';

/**
 * Pure job-tracking state machine (T1.3, FR-3; Design §5/§6 C3/C6). **No React /
 * no IO** → core `src/lib/**` (≥90% coverage gate). The effectful shell
 * (`features/job/useJobTracking`) is a thin adapter that turns EventSource /
 * poll IO into {@link JobEvent}s and feeds them here; **all branching lives in
 * this reducer + the pure predicates** so every transition is deterministically
 * testable (TC-10).
 *
 * Correctness single-points encoded here:
 * - **C3** (partial semantics): an SSE `completed` event does **not** go
 *   straight to a terminal `completed`. It moves to the intermediate
 *   `confirming` state; the authoritative DB `status` (fetched via `GET :id` and
 *   fed back as a `db_status` event) then decides `completed` vs `partial`. A
 *   `partial` job must never be mistaken for a complete one.
 * - **C6** (heartbeat / SSE liveness): the reducer never treats a heartbeat as a
 *   transition (heartbeats are comments the SSE layer drops); connection death
 *   is decided by the pure {@link isConnectionStale} predicate against
 *   `SSE_HEARTBEAT_TIMEOUT_MS`, which the shell turns into a `heartbeat_timeout`
 *   event → poll fallback.
 * - **§7** single authoritative transport: {@link JobState.transport} is `sse`
 *   XOR `poll` (or `none` once terminal); the shell drives exactly the one the
 *   machine selects, never both.
 */

/** Job lifecycle status. `confirming` is the C3 intermediate (SSE completed → awaiting DB truth). */
export type JobStatus =
  'queued' | 'running' | 'confirming' | 'completed' | 'partial' | 'failed' | 'canceled';

/** The single authoritative data source currently driving the job (§7). */
export type Transport = 'sse' | 'poll' | 'none';

/** Progress snapshot (SSE `progress` payload / DB `progress`). All fields optional (null-safe). */
export interface JobProgress {
  readonly phase?: string;
  readonly percent?: number;
  readonly expanded?: number;
  readonly labeled?: number;
  readonly total?: number;
}

/** Terminal result descriptor (SSE `completed` payload / DB `result`). */
export interface JobResult {
  readonly resultSnapshotId?: string;
  readonly count?: number;
}

/** The normalised job-tracking state written to the TanStack Query cache. */
export interface JobState {
  readonly status: JobStatus;
  readonly transport: Transport;
  readonly progress: JobProgress | null;
  readonly result: JobResult | null;
  readonly error: string | null;
}

/** DB (`GET :id`) source-of-truth status — the JobStatus space minus the `confirming` intermediate. */
export type DbStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'canceled';

/** Events the reducer understands (produced by the effectful shell from SSE / poll / user IO). */
export type JobEvent =
  | { readonly type: 'sse_open' }
  | { readonly type: 'progress'; readonly progress: JobProgress }
  | { readonly type: 'sse_completed'; readonly result: JobResult }
  | { readonly type: 'sse_failed'; readonly error: string }
  | { readonly type: 'sse_error' }
  | { readonly type: 'heartbeat_timeout' }
  | { readonly type: 'cancel' }
  | {
      readonly type: 'db_status';
      readonly status: DbStatus;
      readonly progress: JobProgress | null;
      readonly result: JobResult | null;
      readonly error: string | null;
    };

const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'completed',
  'partial',
  'failed',
  'canceled',
]);

/** A job status is terminal once the DB truth is a settled outcome (both transports stop). */
export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Fresh state for a newly-tracked job: queued, SSE as the initial authoritative transport. */
export function initialJobState(): JobState {
  return { status: 'queued', transport: 'sse', progress: null, result: null, error: null };
}

/**
 * Pure SSE-liveness predicate (C6): the connection is considered dead once no
 * activity (open / named event) has been seen for `heartbeatTimeoutMs`. Boundary
 * is inclusive (`>=`) so it flips exactly at the timeout. Heartbeat *comments*
 * are dropped by the SSE layer and never reset this — the shell relies on named
 * events + `onopen`; a quiet connection safely falls back to polling.
 */
export function isConnectionStale(
  lastEventAt: number,
  now: number,
  heartbeatTimeoutMs: number,
): boolean {
  return now - lastEventAt >= heartbeatTimeoutMs;
}

const ProgressFrame = z.object({
  phase: z.string().optional(),
  percent: z.number().optional(),
  expanded: z.number().optional(),
  labeled: z.number().optional(),
  total: z.number().optional(),
});
const CompletedFrame = z.object({
  resultSnapshotId: z.string().optional(),
  count: z.number().optional(),
});
const FailedFrame = z.object({ error: z.string() });

/** Parse JSON, returning `undefined` (not throwing) for a malformed SSE frame. */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Pure SSE frame → {@link JobEvent} decoder (TC-35). Only the three named events
 * (`progress` / `completed` / `failed`) yield a domain event; any other type
 * (including the never-surfaced heartbeat comment) or a body that fails schema
 * validation returns `null` and is ignored — never terminates the stream (C6).
 */
export function toJobEvent(type: string, rawData: string): JobEvent | null {
  switch (type) {
    case 'progress': {
      const parsed = ProgressFrame.safeParse(safeJsonParse(rawData));
      return parsed.success ? { type: 'progress', progress: parsed.data } : null;
    }
    case 'completed': {
      const parsed = CompletedFrame.safeParse(safeJsonParse(rawData));
      return parsed.success ? { type: 'sse_completed', result: parsed.data } : null;
    }
    case 'failed': {
      const parsed = FailedFrame.safeParse(safeJsonParse(rawData));
      return parsed.success ? { type: 'sse_failed', error: parsed.data.error } : null;
    }
    default:
      return null;
  }
}

/** Whether progress-like updates may still be applied (only while queued/running). */
function isProgressable(status: JobStatus): boolean {
  return status === 'queued' || status === 'running';
}

/**
 * The job-tracking reducer. Pure; every guard/transition is exercised by TC-10.
 * Terminal states absorb late events (no revival / no terminal→non-terminal
 * regression); `sse_completed` intentionally lands in `confirming`, never
 * straight to `completed` (C3).
 */
export function jobReducer(state: JobState, event: JobEvent): JobState {
  switch (event.type) {
    case 'sse_open':
      return isTerminal(state.status) ? state : { ...state, transport: 'sse' };
    case 'progress':
      return isProgressable(state.status)
        ? { ...state, status: 'running', progress: event.progress }
        : state;
    case 'sse_completed':
      return isProgressable(state.status)
        ? { ...state, status: 'confirming', result: event.result }
        : state;
    case 'sse_failed':
      return isTerminal(state.status)
        ? state
        : { ...state, status: 'failed', transport: 'none', error: event.error };
    case 'sse_error':
    case 'heartbeat_timeout':
      return isTerminal(state.status) ? state : { ...state, transport: 'poll' };
    case 'cancel':
      return isTerminal(state.status) ? state : { ...state, status: 'canceled', transport: 'none' };
    case 'db_status':
      if (isTerminal(state.status)) return state;
      return {
        status: event.status,
        transport: isTerminal(event.status) ? 'none' : state.transport,
        progress: event.progress,
        result: event.result,
        error: event.error,
      };
  }
}
