import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { JourneyView } from './JourneyView';
import type { EventSourceFactory, EventSourceLike } from '../job/useJobTracking';

/**
 * TC-25 (gate → journey job → 表, T4.4, FR-15) — reuses the T3.3 gate→job→content
 * flow: the gate四態 are driven by `featureStatusOf(features,'journey')`:
 * not_generated → CTA (POST :id/journey), running → JobProgress off the journey
 * stream, ready → 購買歷程表 from `POST /query {view:'journey'}`, failed → retry.
 * The journey SSE is driven deterministically via an injected fake EventSource
 * (same seam as useJobTracking). The stage 表 is fetched via the view-router.
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/** Controllable fake EventSource (jsdom has none) — records every instance the hook opens. */
class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  static last(): FakeEventSource {
    const es = FakeEventSource.instances.at(-1);
    if (!es) throw new Error('no FakeEventSource opened');
    return es;
  }
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
  close(): void {}
  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    (this.listeners.get(type) ?? []).forEach((l) => l(event));
  }
}

const factory: EventSourceFactory = (url) => new FakeEventSource(url);

/** journey stage 表 (POST /query {view:'journey'}). */
const JOURNEY_TABLE = {
  view: 'journey',
  columns: [
    { key: 'text', label: '關鍵字', type: 'text' },
    { key: 'stage', label: '購買歷程階段', type: 'text' },
    { key: 'avgMonthlySearches', label: '月均搜量', type: 'number' },
  ],
  rows: [
    { text: 'iphone 16 vs 15 pro', stage: 'spec_comparison', avgMonthlySearches: 12000 },
    { text: '洗衣精 推薦', stage: 'need_definition', avgMonthlySearches: null },
  ],
  pagination: { total: 2, page: 1, pageSize: 25, cursor: null },
};

/** journey run status (GET /:id/journey) — used by the C3-confirm/poll and partial notice. */
const runBody = (status: string) => ({
  journeyJobId: 'run-1',
  status,
  progress: null,
  keywordCount: 2,
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderView(features: unknown) {
  return render(<JourneyView analysisId={ID} features={features} eventSourceFactory={factory} />, {
    wrapper: wrapper(),
  });
}

beforeEach(() => {
  FakeEventSource.instances = [];
});

describe('TC-25 · JourneyView (gate 四態 → 購買歷程表)', () => {
  it('not_generated → shows the start CTA; clicking POSTs :id/journey and opens the journey stream', async () => {
    let posted = false;
    server.use(
      http.post('/api/v1/keyword-analyses/:id/journey', () => {
        posted = true;
        return HttpResponse.json({ journeyJobId: 'job-1' }, { status: 202 });
      }),
    );
    renderView({});

    expect(screen.getByText(/尚未進行購買歷程分析/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /開始分析/ }));

    await waitFor(() => expect(posted).toBe(true));
    await waitFor(() => expect(screen.getByText('分析進行中')).toBeInTheDocument());
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    expect(FakeEventSource.last().url).toContain(`/keyword-analyses/${ID}/journey/stream`);
  });

  it('ready → fetches POST /query {view:"journey"} and renders the 購買歷程表 rows', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses/:id/query', () => HttpResponse.json(JOURNEY_TABLE)),
      http.get('/api/v1/keyword-analyses/:id/journey', () =>
        HttpResponse.json(runBody('completed')),
      ),
    );
    renderView({ journey: { status: 'ready' } });

    await waitFor(() => expect(screen.getByText('iphone 16 vs 15 pro')).toBeInTheDocument());
    // 步驟號 badge + enum↔zh 鎖死 (spec_comparison = 第 4 階段 規格比較).
    expect(screen.getByText('規格比較')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('running → SSE completed → confirms via GET :id/journey → unlocks the 購買歷程表', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses/:id/query', () => HttpResponse.json(JOURNEY_TABLE)),
      http.get('/api/v1/keyword-analyses/:id/journey', () =>
        HttpResponse.json(runBody('completed')),
      ),
    );
    renderView({ journey: { status: 'running' } });

    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    act(() => FakeEventSource.last().emit('completed', { count: 2 }));

    await waitFor(() => expect(screen.getByText('iphone 16 vs 15 pro')).toBeInTheDocument());
  });

  it('failed → shows a retry button; clicking it POSTs :id/journey again', async () => {
    let posted = false;
    server.use(
      http.post('/api/v1/keyword-analyses/:id/journey', () => {
        posted = true;
        return HttpResponse.json({ journeyJobId: 'job-2' }, { status: 202 });
      }),
    );
    renderView({ journey: { status: 'failed' } });

    fireEvent.click(screen.getByRole('button', { name: /重試/ }));
    await waitFor(() => expect(posted).toBe(true));
  });

  it('start failure (409 snapshot not ready) → finish-analysis-first hint, NOT a generic failure/retry', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses/:id/journey', () =>
        HttpResponse.json({ statusCode: 409, code: 'snapshot_not_ready' }, { status: 409 }),
      ),
    );
    renderView({});

    fireEvent.click(screen.getByRole('button', { name: /開始分析/ }));
    await waitFor(() => expect(screen.getByText(/先完成關鍵字分析/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /重試/ })).not.toBeInTheDocument();
  });

  it('start failure (425 snapshot not ready) → same finish-analysis-first hint', async () => {
    server.use(
      http.post(
        '/api/v1/keyword-analyses/:id/journey',
        () => new HttpResponse(null, { status: 425 }),
      ),
    );
    renderView({});

    fireEvent.click(screen.getByRole('button', { name: /開始分析/ }));
    await waitFor(() => expect(screen.getByText(/先完成關鍵字分析/)).toBeInTheDocument());
  });

  it('start failure (non-not-ready, e.g. 500) → settles into the generic failed/retry state', async () => {
    server.use(
      http.post(
        '/api/v1/keyword-analyses/:id/journey',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderView({});

    fireEvent.click(screen.getByRole('button', { name: /開始分析/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /重試/ })).toBeInTheDocument());
  });

  it('ready + journey run status=partial → shows the 表 AND a partial notice (authoritative run status)', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses/:id/query', () => HttpResponse.json(JOURNEY_TABLE)),
      http.get('/api/v1/keyword-analyses/:id/journey', () => HttpResponse.json(runBody('partial'))),
    );
    renderView({ journey: { status: 'ready' } });

    await waitFor(() => expect(screen.getByText('iphone 16 vs 15 pro')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/部分/);
  });

  it('running → SSE failed → settles into the failed state', async () => {
    renderView({ journey: { status: 'running' } });

    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    act(() => FakeEventSource.last().emit('failed', { error: 'boom' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /重試/ })).toBeInTheDocument());
  });

  it('ready but POST /query returns a non-table shape → renders the empty state (defensive)', async () => {
    // journey must always be a table view; a trend/chart body (backend drift) must not
    // render half-parsed — the gate stays ready but the 表 falls back to the empty state.
    server.use(
      http.post('/api/v1/keyword-analyses/:id/query', () =>
        HttpResponse.json({ view: 'trend', axis: [], total: [], series: [] }),
      ),
      http.get('/api/v1/keyword-analyses/:id/journey', () =>
        HttpResponse.json(runBody('completed')),
      ),
    );
    renderView({ journey: { status: 'ready' } });

    await waitFor(() => expect(screen.getByText(/尚無購買歷程資料/)).toBeInTheDocument());
  });

  it('ready but POST /query fails → renders the empty state (no crash)', async () => {
    server.use(
      http.post(
        '/api/v1/keyword-analyses/:id/query',
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.get('/api/v1/keyword-analyses/:id/journey', () =>
        HttpResponse.json(runBody('completed')),
      ),
    );
    renderView({ journey: { status: 'ready' } });

    await waitFor(() => expect(screen.getByText(/尚無購買歷程資料/)).toBeInTheDocument());
  });
});
