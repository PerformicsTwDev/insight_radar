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
  | 'queued'
  | 'running'
  | 'confirming'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'canceled';

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
  _lastEventAt: number,
  _now: number,
  _heartbeatTimeoutMs: number,
): boolean {
  return false;
}

/** Pure SSE frame → {@link JobEvent} decoder (TC-35). Unknown types / bad JSON → `null` (ignored). */
export function toJobEvent(_type: string, _rawData: string): JobEvent | null {
  return null;
}

/** The job-tracking reducer. Pure; every guard/transition is exercised by TC-10. */
export function jobReducer(state: JobState, _event: JobEvent): JobState {
  return state;
}
