import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { config } from '../../config/env';
import { server } from '../../api/msw/server';
import {
  buildStreamUrl,
  defaultEventSourceFactory,
  useJobTracking,
  type EventSourceFactory,
  type EventSourceLike,
} from './useJobTracking';
import { toJobEvent } from '../../lib/jobState';

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/**
 * Controllable fake `EventSource` (jsdom has none). Records every instance the
 * hook opens; the test drives it via `emitOpen` / `emit(type,data)` /
 * `emitRaw` / `emitComment` / `emitError`. A heartbeat comment (`: keep-alive`)
 * is modelled as a no-op — matching the browser, which consumes SSE comments and
 * never surfaces them to named-event listeners (C6).
 */
class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  static last(): FakeEventSource {
    const es = FakeEventSource.instances.at(-1);
    if (!es) throw new Error('no FakeEventSource opened');
    return es;
  }
  closed = false;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }
  close(): void {
    this.closed = true;
  }
  emitOpen(): void {
    this.onopen?.(new Event('open'));
  }
  emit(type: string, data: unknown): void {
    this.emitRaw(type, JSON.stringify(data));
  }
  emitRaw(type: string, rawData: string): void {
    const event = new MessageEvent(type, { data: rawData });
    (this.listeners.get(type) ?? []).forEach((l) => l(event));
  }
  emitComment(): void {
    // heartbeat comment — never dispatched to listeners (no-op), mirroring the browser.
  }
  emitError(): void {
    this.onerror?.(new Event('error'));
  }
}

const factory: EventSourceFactory = (url) => new FakeEventSource(url);

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderJob(analysisId: string | undefined, f: EventSourceFactory = factory) {
  return renderHook(() => useJobTracking(analysisId, { eventSourceFactory: f }), {
    wrapper: wrapper(),
  });
}

beforeEach(() => {
  FakeEventSource.instances = [];
});

describe('TC-35 · toJobEvent (pure SSE frame decoder)', () => {
  it('decodes a progress frame', () => {
    expect(toJobEvent('progress', JSON.stringify({ phase: 'expand', percent: 5 }))).toEqual({
      type: 'progress',
      progress: { phase: 'expand', percent: 5 },
    });
  });

  it('decodes a completed frame → sse_completed (intermediate; NOT terminal)', () => {
    expect(toJobEvent('completed', JSON.stringify({ resultSnapshotId: 's', count: 3 }))).toEqual({
      type: 'sse_completed',
      result: { resultSnapshotId: 's', count: 3 },
    });
  });

  it('decodes a failed frame → sse_failed', () => {
    expect(toJobEvent('failed', JSON.stringify({ error: 'quota' }))).toEqual({
      type: 'sse_failed',
      error: 'quota',
    });
  });

  it('ignores unknown event types + heartbeat comment content (→ null)', () => {
    expect(toJobEvent('message', '{}')).toBeNull();
    expect(toJobEvent('', ': keep-alive')).toBeNull();
  });

  it('ignores malformed JSON in each named event (→ null)', () => {
    expect(toJobEvent('progress', 'not-json')).toBeNull();
    expect(toJobEvent('completed', 'not-json')).toBeNull();
    expect(toJobEvent('failed', 'not-json')).toBeNull();
  });
});

describe('TC-35 · buildStreamUrl', () => {
  it('resolves same-origin when apiBaseUrl is empty (and encodes the id)', () => {
    expect(buildStreamUrl('a b', '', 'http://localhost:3000')).toBe(
      'http://localhost:3000/api/v1/keyword-analyses/a%20b/stream',
    );
  });
  it('uses apiBaseUrl when configured (cross-host)', () => {
    expect(buildStreamUrl('id1', 'https://api.example.com', 'http://localhost:3000')).toBe(
      'https://api.example.com/api/v1/keyword-analyses/id1/stream',
    );
  });
});

describe('TC-35 · useJobTracking SSE parsing (progress / completed / failed / comment)', () => {
  it('parses progress events → running with the payload', async () => {
    const { result } = renderJob(ID);
    act(() => {
      FakeEventSource.last().emitOpen();
      FakeEventSource.last().emit('progress', { phase: 'expand', percent: 30 });
    });
    await waitFor(() => expect(result.current.state.status).toBe('running'));
    expect(result.current.state.progress).toEqual({ phase: 'expand', percent: 30 });
    expect(FakeEventSource.last().url).toContain(`/keyword-analyses/${ID}/stream`);
  });

  it('ignores a heartbeat comment: no transition and does NOT terminate the stream (C6)', async () => {
    const { result } = renderJob(ID);
    act(() => {
      FakeEventSource.last().emitOpen();
      FakeEventSource.last().emit('progress', { percent: 20 });
    });
    await waitFor(() => expect(result.current.state.status).toBe('running'));

    act(() => FakeEventSource.last().emitComment());
    expect(result.current.state.status).toBe('running'); // unchanged
    expect(FakeEventSource.last().closed).toBe(false); // stream still open
  });

  it('ignores a malformed SSE frame (unparseable data → no transition)', () => {
    const { result } = renderJob(ID);
    act(() => FakeEventSource.last().emitRaw('progress', 'not json'));
    expect(result.current.state.status).toBe('queued');
  });

  it('failed event → failed terminal (error surfaced, stream closed)', async () => {
    const { result } = renderJob(ID);
    act(() => FakeEventSource.last().emit('failed', { error: 'quota exceeded' }));
    await waitFor(() => expect(result.current.state.status).toBe('failed'));
    expect(result.current.state.error).toBe('quota exceeded');
    expect(FakeEventSource.last().closed).toBe(true);
  });
});

describe('TC-35 · C3 partial confirmation (completed → GET :id decides)', () => {
  it('completed event → fetches GET :id → partial (never mistaken for completed)', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id', () =>
        HttpResponse.json({ status: 'partial', result: { count: 8 } }, { status: 200 }),
      ),
    );
    const { result } = renderJob(ID);
    act(() => FakeEventSource.last().emit('completed', { resultSnapshotId: 'snap', count: 12 }));

    await waitFor(() => expect(result.current.state.status).toBe('partial'));
    expect(result.current.state.result).toEqual({ count: 8 });
    expect(FakeEventSource.last().closed).toBe(true);
  });

  it('completed event → GET :id says completed → completed terminal', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id', () =>
        HttpResponse.json(
          { status: 'completed', result: { resultSnapshotId: 'snap', count: 12 } },
          { status: 200 },
        ),
      ),
    );
    const { result } = renderJob(ID);
    act(() => FakeEventSource.last().emit('completed', { resultSnapshotId: 'snap', count: 12 }));

    await waitFor(() => expect(result.current.state.status).toBe('completed'));
    expect(result.current.state.result).toEqual({ resultSnapshotId: 'snap', count: 12 });
  });
});

describe('TC-35 · SSE-broken → poll fallback (§7 single authoritative transport)', () => {
  it('SSE error closes the stream and falls back to polling GET :id', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id', () =>
        HttpResponse.json({ status: 'running', progress: { percent: 55 } }, { status: 200 }),
      ),
    );
    const { result } = renderJob(ID);
    const es = FakeEventSource.last();
    act(() => es.emitError());

    await waitFor(() => expect(result.current.state.transport).toBe('poll'));
    expect(es.closed).toBe(true);
    await waitFor(() => expect(result.current.state.progress).toEqual({ percent: 55 }));
  });

  it('heartbeat silence past the timeout closes the stream and falls back to poll (C6)', () => {
    vi.useFakeTimers();
    server.use(
      http.get('/api/v1/keyword-analyses/:id', () =>
        HttpResponse.json({ status: 'running' }, { status: 200 }),
      ),
    );
    const { result, unmount } = renderJob(ID);
    const es = FakeEventSource.last();
    act(() => {
      vi.advanceTimersByTime(config.sseHeartbeatTimeoutMs + config.pollIntervalMs);
    });
    expect(result.current.state.transport).toBe('poll');
    expect(es.closed).toBe(true);
    unmount();
    vi.useRealTimers();
  });

  it('falls back to poll immediately when no EventSource is available (factory → null)', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id', () =>
        HttpResponse.json({ status: 'running', progress: { percent: 5 } }, { status: 200 }),
      ),
    );
    const { result } = renderJob(ID, () => null);
    await waitFor(() => expect(result.current.state.transport).toBe('poll'));
    await waitFor(() => expect(result.current.state.status).toBe('running'));
  });
});

describe('TC-35 · cancel + no-analysis guards', () => {
  it('cancel() calls DELETE :id and settles to canceled', async () => {
    let deleted = false;
    server.use(
      http.delete('/api/v1/keyword-analyses/:id', () => {
        deleted = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const { result } = renderJob(ID);
    await act(async () => {
      await result.current.cancel();
    });
    expect(deleted).toBe(true);
    expect(result.current.state.status).toBe('canceled');
    expect(FakeEventSource.last().closed).toBe(true);
  });

  it('does nothing without an analysisId (no EventSource, cancel is a no-op)', async () => {
    const { result } = renderJob(undefined);
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.state.status).toBe('queued');
    await act(async () => {
      await result.current.cancel();
    });
    expect(result.current.state.status).toBe('queued');
  });
});

describe('TC-35 · defaultEventSourceFactory', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns null when the platform has no EventSource', () => {
    vi.stubGlobal('EventSource', undefined);
    expect(defaultEventSourceFactory('http://x/api/v1/keyword-analyses/1/stream')).toBeNull();
  });

  it('constructs an EventSource when available', () => {
    class E {
      onopen = null;
      onerror = null;
      constructor(public url: string) {}
      addEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal('EventSource', E);
    expect(defaultEventSourceFactory('http://x/api/v1/keyword-analyses/1/stream')).not.toBeNull();
  });
});
