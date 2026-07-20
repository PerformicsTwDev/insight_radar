import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { useAiIntentBatch } from './useAiIntentBatch';
import type { EventSourceFactory, EventSourceLike } from '../job/useJobTracking';

/**
 * TC-28 (hook, batch) — the ✦ column-header batch coordinator (T4.2, FR-18 /
 * AC-18.1). `startBatch` POSTs `{scope:'snapshot'}` (202 → jobId), masks the whole
 * column loading, and opens the batch SSE (reusing the useJobTracking EventSource
 * seam + buildStreamUrl). Each SSE `progress` frame progressively fills exactly one
 * cell (idle→loading→done|error); a per-cell failure is isolated (partial). The SSE
 * is driven deterministically via an injected fake EventSource.
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ROUTE = '/api/v1/keyword-analyses/:id/ai-intent-summary';
const A = 'running shoes';
const B = 'cheap running shoes';
const C = 'best trail shoes';

/** Controllable fake EventSource (jsdom has none) — records every instance the hook opens. */
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
  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    (this.listeners.get(type) ?? []).forEach((l) => l(event));
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

function renderBatch(keys: string[]) {
  return renderHook(() => useAiIntentBatch(ID, keys, { eventSourceFactory: factory }), {
    wrapper: wrapper(),
  });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  // Default: the snapshot job starts successfully.
  server.use(http.post(ROUTE, () => HttpResponse.json({ jobId: 'batch-job-1' }, { status: 202 })));
});

describe('TC-28 · useAiIntentBatch — startBatch fans the column out over SSE', () => {
  it('starts idle (every cell masked) before any trigger', () => {
    const { result } = renderBatch([A, B, C]);
    expect(result.current.job).toBe('idle');
    expect(result.current.cellStateFor(A).status).toBe('idle');
  });

  it('startBatch → POSTs {scope:snapshot}, masks all cells loading, and opens the batch stream', async () => {
    let received: unknown;
    server.use(
      http.post(ROUTE, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ jobId: 'batch-job-1' }, { status: 202 });
      }),
    );
    const { result } = renderBatch([A, B, C]);

    await act(async () => {
      await result.current.startBatch();
    });

    expect(received).toEqual({ scope: 'snapshot' });
    expect(result.current.job).toBe('running');
    expect(result.current.cellStateFor(A).status).toBe('loading');
    expect(result.current.cellStateFor(B).status).toBe('loading');

    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    // Reuses the useJobTracking stream-url convention (analysis-scoped sub-path).
    expect(FakeEventSource.last().url).toContain(`/keyword-analyses/${ID}/`);
  });

  it('each SSE progress frame progressively fills exactly one cell (idle→loading→done)', async () => {
    const { result } = renderBatch([A, B, C]);
    await act(async () => {
      await result.current.startBatch();
    });
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));

    act(() => FakeEventSource.last().emit('progress', { normalizedText: A, summary: 'A 摘要' }));
    expect(result.current.cellStateFor(A)).toMatchObject({ status: 'done', summary: 'A 摘要' });
    // B and C are still filling in (not yet delivered).
    expect(result.current.cellStateFor(B).status).toBe('loading');
    expect(result.current.cellStateFor(C).status).toBe('loading');

    act(() => FakeEventSource.last().emit('progress', { normalizedText: B, summary: 'B 摘要' }));
    act(() => FakeEventSource.last().emit('progress', { normalizedText: C, summary: 'C 摘要' }));
    expect(result.current.cellStateFor(B).status).toBe('done');
    expect(result.current.cellStateFor(C).status).toBe('done');
  });

  it('a single failing cell → that cell errors, the others still resolve (AC-18.1 partial)', async () => {
    const { result } = renderBatch([A, B, C]);
    await act(async () => {
      await result.current.startBatch();
    });
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));

    // B fails; A and C succeed.
    act(() => FakeEventSource.last().emit('progress', { normalizedText: B, error: 'llm_timeout' }));
    act(() => FakeEventSource.last().emit('progress', { normalizedText: A, summary: 'A 摘要' }));
    act(() => FakeEventSource.last().emit('progress', { normalizedText: C, summary: 'C 摘要' }));

    expect(result.current.cellStateFor(B)).toMatchObject({
      status: 'error',
      errorKind: 'unavailable',
    });
    expect(result.current.cellStateFor(A)).toMatchObject({ status: 'done', summary: 'A 摘要' });
    expect(result.current.cellStateFor(C)).toMatchObject({ status: 'done', summary: 'C 摘要' });
  });

  it('SSE completed → job done and the stream is torn down (no leak)', async () => {
    const { result } = renderBatch([A]);
    await act(async () => {
      await result.current.startBatch();
    });
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    const source = FakeEventSource.last();

    act(() => source.emit('progress', { normalizedText: A, summary: 'A 摘要' }));
    act(() => source.emit('completed', {}));

    await waitFor(() => expect(result.current.job).toBe('done'));
    await waitFor(() => expect(source.closed).toBe(true));
  });

  it('SSE failed → job errors (whole-job failure surfaced to the header)', async () => {
    const { result } = renderBatch([A]);
    await act(async () => {
      await result.current.startBatch();
    });
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));

    act(() => FakeEventSource.last().emit('failed', { error: 'boom' }));
    await waitFor(() => expect(result.current.job).toBe('error'));
  });

  it('startBatch on a POST failure (500) → job errors without opening a stream', async () => {
    server.use(http.post(ROUTE, () => new HttpResponse(null, { status: 500 })));
    const { result } = renderBatch([A]);

    await act(async () => {
      await result.current.startBatch();
    });

    expect(result.current.job).toBe('error');
    expect(FakeEventSource.instances.length).toBe(0);
  });

  it('an EventSource transport error (onerror) → whole-job failure', async () => {
    const { result } = renderBatch([A]);
    await act(async () => {
      await result.current.startBatch();
    });
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));

    act(() => FakeEventSource.last().emitError());
    await waitFor(() => expect(result.current.job).toBe('error'));
  });

  it('no EventSource on the platform (factory returns null) → whole-job failure', async () => {
    const { result } = renderHook(
      () => useAiIntentBatch(ID, [A], { eventSourceFactory: () => null }),
      { wrapper: wrapper() },
    );

    await act(async () => {
      await result.current.startBatch();
    });

    await waitFor(() => expect(result.current.job).toBe('error'));
  });
});

describe('TC-28 · useAiIntentBatch — generateOne (single-cell path shares the same map)', () => {
  it('generateOne fills a single cell synchronously without starting the batch job', async () => {
    server.use(
      http.post(ROUTE, () =>
        HttpResponse.json({ normalizedText: A, summary: '單格摘要' }, { status: 200 }),
      ),
    );
    const { result } = renderBatch([A, B]);

    await act(async () => {
      await result.current.generateOne(A);
    });

    expect(result.current.job).toBe('idle'); // single click does not start the batch job
    expect(result.current.cellStateFor(A)).toMatchObject({ status: 'done', summary: '單格摘要' });
    expect(result.current.cellStateFor(B).status).toBe('idle');
  });

  it('generateOne surfaces a 400 (missing key) as the non-retryable invalid kind', async () => {
    server.use(
      http.post(ROUTE, () =>
        HttpResponse.json({ statusCode: 400, code: 'normalizedText_required' }, { status: 400 }),
      ),
    );
    const { result } = renderBatch([A]);

    await act(async () => {
      await result.current.generateOne(A);
    });

    expect(result.current.cellStateFor(A)).toMatchObject({ status: 'error', errorKind: 'invalid' });
  });
});
