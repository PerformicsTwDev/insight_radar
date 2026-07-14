import {
  initialJobState,
  isConnectionStale,
  isTerminal,
  jobReducer,
  type JobEvent,
  type JobState,
  type JobStatus,
} from './jobState';

/** Apply a sequence of events from a starting state (defaults to the fresh initial state). */
function run(events: JobEvent[], from: JobState = initialJobState()): JobState {
  return events.reduce(jobReducer, from);
}

const progressEvt: JobEvent = { type: 'progress', progress: { phase: 'expand', percent: 42 } };
const dbTerminal = (status: JobStatus): JobEvent =>
  ({ type: 'db_status', status, progress: null, result: null, error: null }) as JobEvent;

describe('TC-10 · jobState.initialJobState + isTerminal', () => {
  it('starts queued on the SSE transport with no progress/result/error', () => {
    expect(initialJobState()).toEqual({
      status: 'queued',
      transport: 'sse',
      progress: null,
      result: null,
      error: null,
    });
  });

  it('classifies terminal vs non-terminal statuses', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('partial')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('canceled')).toBe(true);
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('confirming')).toBe(false);
  });
});

describe('TC-10 · jobState progress transitions', () => {
  it('queued → running on the first progress event (carries the payload)', () => {
    const s = run([progressEvt]);
    expect(s.status).toBe('running');
    expect(s.progress).toEqual({ phase: 'expand', percent: 42 });
    expect(s.transport).toBe('sse');
  });

  it('running → running on further progress (latest snapshot wins)', () => {
    const s = run([progressEvt, { type: 'progress', progress: { phase: 'label', percent: 90 } }]);
    expect(s.status).toBe('running');
    expect(s.progress).toEqual({ phase: 'label', percent: 90 });
  });

  it('ignores progress once confirming (does not regress the C3 intermediate)', () => {
    const s = run([progressEvt, { type: 'sse_completed', result: { count: 5 } }, progressEvt]);
    expect(s.status).toBe('confirming');
  });

  it('ignores progress once terminal', () => {
    const s = run([{ type: 'sse_failed', error: 'boom' }, progressEvt]);
    expect(s.status).toBe('failed');
  });

  it('sse_open keeps state but re-selects the SSE transport; ignored once terminal', () => {
    expect(run([{ type: 'sse_error' }, { type: 'sse_open' }]).transport).toBe('sse');
    const terminal = run([dbTerminal('completed'), { type: 'sse_open' }]);
    expect(terminal.status).toBe('completed');
    expect(terminal.transport).toBe('none');
  });
});

describe('TC-10 · C3 partial confirmation (SSE completed is NOT terminal-completed)', () => {
  it('sse_completed → confirming (intermediate), NOT completed', () => {
    const s = run([progressEvt, { type: 'sse_completed', result: { resultSnapshotId: 'snap-1', count: 12 } }]);
    expect(s.status).toBe('confirming');
    expect(s.result).toEqual({ resultSnapshotId: 'snap-1', count: 12 });
    expect(s.transport).toBe('sse'); // still SSE until GET :id confirms
  });

  it('confirming + DB says completed → completed terminal (transport none)', () => {
    const s = run([
      { type: 'sse_completed', result: { count: 12 } },
      { type: 'db_status', status: 'completed', progress: null, result: { resultSnapshotId: 'snap', count: 12 }, error: null },
    ]);
    expect(s.status).toBe('completed');
    expect(s.result).toEqual({ resultSnapshotId: 'snap', count: 12 });
    expect(s.transport).toBe('none');
  });

  it('confirming + DB says partial → partial terminal (never mistaken for completed)', () => {
    const s = run([
      { type: 'sse_completed', result: { count: 12 } },
      { type: 'db_status', status: 'partial', progress: null, result: { count: 8 }, error: null },
    ]);
    expect(s.status).toBe('partial');
    expect(s.result).toEqual({ count: 8 });
    expect(s.transport).toBe('none');
  });

  it('ignores sse_completed once terminal', () => {
    const s = run([dbTerminal('partial'), { type: 'sse_completed', result: { count: 1 } }]);
    expect(s.status).toBe('partial');
  });
});

describe('TC-10 · failed / cancel terminals', () => {
  it('sse_failed → failed terminal with the error message + transport none', () => {
    const s = run([progressEvt, { type: 'sse_failed', error: 'quota exceeded' }]);
    expect(s.status).toBe('failed');
    expect(s.error).toBe('quota exceeded');
    expect(s.transport).toBe('none');
  });

  it('cancel → canceled terminal (transport none); ignored once terminal', () => {
    expect(run([progressEvt, { type: 'cancel' }]).status).toBe('canceled');
    expect(run([progressEvt, { type: 'cancel' }]).transport).toBe('none');
    expect(run([dbTerminal('completed'), { type: 'cancel' }]).status).toBe('completed');
  });
});

describe('TC-10 · db_status (poll) transitions', () => {
  it('applies a running DB snapshot, keeping the poll transport', () => {
    const from: JobState = { status: 'running', transport: 'poll', progress: null, result: null, error: null };
    const s = jobReducer(from, {
      type: 'db_status',
      status: 'running',
      progress: { percent: 30 },
      result: null,
      error: null,
    });
    expect(s.status).toBe('running');
    expect(s.progress).toEqual({ percent: 30 });
    expect(s.transport).toBe('poll');
  });

  it('applies a queued DB snapshot (still non-terminal)', () => {
    const s = jobReducer(initialJobState(), dbTerminal('queued'));
    expect(s.status).toBe('queued');
    expect(s.transport).toBe('sse');
  });

  it('poll reaching a terminal DB status settles + stops transports (failed / canceled)', () => {
    const from: JobState = { status: 'running', transport: 'poll', progress: null, result: null, error: null };
    const failed = jobReducer(from, { type: 'db_status', status: 'failed', progress: null, result: null, error: 'nope' });
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('nope');
    expect(failed.transport).toBe('none');

    const canceled = jobReducer(from, dbTerminal('canceled'));
    expect(canceled.status).toBe('canceled');
    expect(canceled.transport).toBe('none');
  });

  it('ignores a db_status once already terminal (no terminal → non-terminal regression)', () => {
    const s = run([dbTerminal('completed'), dbTerminal('running')]);
    expect(s.status).toBe('completed');
  });
});

describe('TC-10 · SSE-broken → poll fallback (§7)', () => {
  it('sse_error switches the authoritative transport to poll (non-terminal)', () => {
    expect(run([progressEvt, { type: 'sse_error' }]).transport).toBe('poll');
    expect(run([progressEvt, { type: 'sse_error' }]).status).toBe('running');
  });

  it('heartbeat_timeout switches to poll (non-terminal)', () => {
    expect(run([{ type: 'heartbeat_timeout' }]).transport).toBe('poll');
  });

  it('ignores sse_error / heartbeat_timeout once terminal (no revival)', () => {
    expect(run([dbTerminal('completed'), { type: 'sse_error' }]).transport).toBe('none');
    expect(run([dbTerminal('completed'), { type: 'heartbeat_timeout' }]).transport).toBe('none');
  });
});

describe('TC-10 · isConnectionStale (C6 heartbeat predicate)', () => {
  const TIMEOUT = 20_000;
  it('is not stale before the timeout window elapses', () => {
    expect(isConnectionStale(1000, 1000 + TIMEOUT - 1, TIMEOUT)).toBe(false);
  });
  it('flips to stale exactly at the timeout boundary (inclusive)', () => {
    expect(isConnectionStale(1000, 1000 + TIMEOUT, TIMEOUT)).toBe(true);
  });
  it('is stale well past the timeout', () => {
    expect(isConnectionStale(1000, 1000 + TIMEOUT * 3, TIMEOUT)).toBe(true);
  });
});
