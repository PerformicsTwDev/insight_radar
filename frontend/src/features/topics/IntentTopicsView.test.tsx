import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { IntentTopicsView } from './IntentTopicsView';
import type { EventSourceFactory, EventSourceLike } from '../job/useJobTracking';

/**
 * TC-19 (gate → 表格) — the intent-topics container (T3.3, FR-8). The gate四態 are
 * driven by `featureStatusOf(features,'topics')`: not_generated → CTA (POST
 * :id/topics), running → JobProgress off the topics stream, ready → 主題表 from GET
 * :id/topics, failed → retry. The topics SSE is driven deterministically via an
 * injected fake EventSource (same seam as useJobTracking).
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

const TOPICS_BODY = {
  status: 'completed',
  progress: null,
  clusters: [
    {
      topicName: '線上課程比較',
      parentTopic: '線上學習',
      intentLabel: 'commercial',
      topicType: 'head',
      reason: null,
      clusterVolume: 42000,
      keywordCount: 2,
      confidence: 0.8,
      representativeKeywords: null,
    },
  ],
  keywords: [],
  meta: { runId: 'r', snapshotId: 's', clusterCount: 1, noiseCount: 0 },
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderView(features: unknown) {
  return render(
    <IntentTopicsView analysisId={ID} features={features} eventSourceFactory={factory} />,
    { wrapper: wrapper() },
  );
}

beforeEach(() => {
  FakeEventSource.instances = [];
});

describe('TC-19 · IntentTopicsView (gate 四態 → 主題表)', () => {
  it('not_generated → shows the start CTA; clicking POSTs :id/topics and opens the topics stream', async () => {
    let posted = false;
    server.use(
      http.post('/api/v1/keyword-analyses/:id/topics', () => {
        posted = true;
        return HttpResponse.json({ topicJobId: 'job-1' }, { status: 202 });
      }),
    );
    renderView({});

    expect(screen.getByText(/尚未進行意圖主題分析/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /開始分析/ }));

    await waitFor(() => expect(posted).toBe(true));
    await waitFor(() => expect(screen.getByText('分析進行中')).toBeInTheDocument());
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    expect(FakeEventSource.last().url).toContain(`/keyword-analyses/${ID}/topics/stream`);
  });

  it('ready → fetches GET :id/topics and renders the 主題表 cluster rows', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id/topics', () => HttpResponse.json(TOPICS_BODY)),
    );
    renderView({ topics: { status: 'ready' } });

    await waitFor(() => expect(screen.getByText('線上課程比較')).toBeInTheDocument());
  });

  it('running → SSE completed → confirms via GET :id → unlocks the 主題表', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id/topics', () => HttpResponse.json(TOPICS_BODY)),
      http.get('/api/v1/keyword-analyses/:id', () =>
        HttpResponse.json({ status: 'completed', result: { count: 2 } }, { status: 200 }),
      ),
    );
    renderView({ topics: { status: 'running' } });

    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    act(() => FakeEventSource.last().emit('completed', { count: 2 }));

    await waitFor(() => expect(screen.getByText('線上課程比較')).toBeInTheDocument());
  });

  it('failed → shows a retry button; clicking it POSTs :id/topics again', async () => {
    let posted = false;
    server.use(
      http.post('/api/v1/keyword-analyses/:id/topics', () => {
        posted = true;
        return HttpResponse.json({ topicJobId: 'job-2' }, { status: 202 });
      }),
    );
    renderView({ topics: { status: 'failed' } });

    fireEvent.click(screen.getByRole('button', { name: /重試/ }));
    await waitFor(() => expect(posted).toBe(true));
  });

  it('start failure (409 snapshot not ready) → shows the finish-analysis-first hint, NOT a generic failure/retry (FR-8 boundary)', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses/:id/topics', () =>
        HttpResponse.json({ statusCode: 409, code: 'snapshot_not_ready' }, { status: 409 }),
      ),
    );
    renderView({});

    fireEvent.click(screen.getByRole('button', { name: /開始分析/ }));
    await waitFor(() => expect(screen.getByText(/先完成關鍵字分析/)).toBeInTheDocument());
    // Not a failed run — no "分析失敗/重試"; the CTA stays available for after the base analysis finishes.
    expect(screen.queryByRole('button', { name: /重試/ })).not.toBeInTheDocument();
  });

  it('start failure (425 snapshot not ready) → same finish-analysis-first hint', async () => {
    server.use(
      http.post(
        '/api/v1/keyword-analyses/:id/topics',
        () => new HttpResponse(null, { status: 425 }),
      ),
    );
    renderView({});

    fireEvent.click(screen.getByRole('button', { name: /開始分析/ }));
    await waitFor(() => expect(screen.getByText(/先完成關鍵字分析/)).toBeInTheDocument());
  });

  it('ready + topics.status=partial → shows the 主題表 AND a partial notice (C3; authoritative TopicsResponse.status)', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id/topics', () =>
        HttpResponse.json({ ...TOPICS_BODY, status: 'partial' }),
      ),
    );
    renderView({ topics: { status: 'ready' } });

    await waitFor(() => expect(screen.getByText('線上課程比較')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/部分/);
  });

  it('running → SSE failed → settles into the failed state', async () => {
    renderView({ topics: { status: 'running' } });

    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    act(() => FakeEventSource.last().emit('failed', { error: 'boom' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /重試/ })).toBeInTheDocument());
  });

  it('ready but GET :id/topics fails → renders the empty state (no crash)', async () => {
    server.use(
      http.get(
        '/api/v1/keyword-analyses/:id/topics',
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    renderView({ topics: { status: 'ready' } });

    await waitFor(() => expect(screen.getByText(/尚無主題資料/)).toBeInTheDocument());
  });
});
