import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { KeywordsTable } from './KeywordsTable';
import { IntentTopicsView } from '../topics/IntentTopicsView';
import type { KeywordRow } from '../../api/keywords';
import type { EventSourceFactory, EventSourceLike } from '../job/useJobTracking';

/**
 * TC-28 (component, batch) — the ✦ column-header batch generation (T4.2, FR-18 /
 * AC-18.1). Clicking the column-header ✦ triggers a `scope:'snapshot'` async job;
 * cells fill progressively as SSE `progress` frames arrive (idle→loading→done). A
 * failing cell shows its error while its siblings still resolve (partial). And the
 * C13 decoupling guard: batch generation must NOT unlock the left-side dimension
 * view. Backend FR-31 is deferred → the endpoint + SSE are mocked.
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ROUTE = '/api/v1/keyword-analyses/:id/ai-intent-summary';
const BATCH_LABEL = '批次生成 AI 歸納搜尋意圖';
const CELL_LABEL = 'AI 歸納搜尋意圖';

const rows: KeywordRow[] = [
  {
    text: 'running shoes',
    normalizedText: 'running shoes',
    intentLabels: ['commercial'],
    avgMonthlySearches: 12000,
    competition: 'HIGH',
    competitionIndex: 88,
    cpcLow: 1.2,
    cpcHigh: 3.4,
    monthlyVolumes: [],
  },
  {
    text: 'cheap running shoes',
    normalizedText: 'cheap running shoes',
    intentLabels: ['commercial'],
    avgMonthlySearches: 800,
    competition: 'MEDIUM',
    competitionIndex: 55,
    cpcLow: 0.5,
    cpcHigh: 1.1,
    monthlyVolumes: [],
  },
  {
    text: 'best trail shoes',
    normalizedText: 'best trail shoes',
    intentLabels: ['informational'],
    avgMonthlySearches: 300,
    competition: 'LOW',
    competitionIndex: 20,
    cpcLow: 0.3,
    cpcHigh: 0.7,
    monthlyVolumes: [],
  },
];

/** Controllable fake EventSource (jsdom has none). */
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

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/**
 * The ✦ cell for a given 搜尋詞 row (last cell in the row). Matches on the frozen
 * first cell's exact text so 'running shoes' never also selects 'cheap running shoes'.
 */
function aiCellOf(text: string): HTMLElement {
  const row = screen.getAllByRole('row').find((r) => {
    const cells = within(r).queryAllByRole('cell');
    return cells.length > 0 && cells[0].textContent === text;
  });
  if (!row) throw new Error(`no row with 搜尋詞 "${text}"`);
  const cells = within(row).getAllByRole('cell');
  return cells[cells.length - 1];
}

beforeEach(() => {
  FakeEventSource.instances = [];
  server.use(http.post(ROUTE, () => HttpResponse.json({ jobId: 'batch-job-1' }, { status: 202 })));
});

describe('TC-28 · KeywordsTable ✦ column-header batch (progressive SSE fill)', () => {
  it('the column header exposes a batch-generate trigger distinct from the per-cell buttons', () => {
    render(<KeywordsTable rows={rows} analysisId={ID} eventSourceFactory={factory} />, {
      wrapper: wrapper(),
    });
    expect(screen.getByRole('button', { name: BATCH_LABEL })).toBeInTheDocument();
    // Still one interactive per-cell ✦ per row (the batch trigger is separate).
    expect(screen.getAllByRole('button', { name: CELL_LABEL })).toHaveLength(rows.length);
  });

  it('clicking the header POSTs {scope:snapshot} then fills the cells progressively as SSE frames arrive', async () => {
    let received: unknown;
    server.use(
      http.post(ROUTE, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ jobId: 'batch-job-1' }, { status: 202 });
      }),
    );
    render(<KeywordsTable rows={rows} analysisId={ID} eventSourceFactory={factory} />, {
      wrapper: wrapper(),
    });

    fireEvent.click(screen.getByRole('button', { name: BATCH_LABEL }));

    // All cells enter the loading state; the per-cell generate buttons are gone.
    await waitFor(() =>
      expect(within(aiCellOf('running shoes')).getByRole('status')).toBeInTheDocument(),
    );
    expect(screen.queryAllByRole('button', { name: CELL_LABEL })).toHaveLength(0);
    expect(received).toEqual({ scope: 'snapshot' });

    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));

    // First frame fills only the first cell; the others are still loading.
    act(() =>
      FakeEventSource.last().emit('progress', {
        normalizedText: 'running shoes',
        summary: '導購型：比較品牌與價格',
      }),
    );
    await waitFor(() =>
      expect(within(aiCellOf('running shoes')).getByText('導購型：比較品牌與價格')).toBeInTheDocument(),
    );
    expect(within(aiCellOf('cheap running shoes')).getByRole('status')).toBeInTheDocument();

    // Remaining frames fill the rest.
    act(() =>
      FakeEventSource.last().emit('progress', {
        normalizedText: 'cheap running shoes',
        summary: '導購型：找便宜款',
      }),
    );
    act(() =>
      FakeEventSource.last().emit('progress', {
        normalizedText: 'best trail shoes',
        summary: '資訊型：越野鞋比較',
      }),
    );
    await waitFor(() =>
      expect(within(aiCellOf('best trail shoes')).getByText('資訊型：越野鞋比較')).toBeInTheDocument(),
    );
  });

  it('a single failing cell shows its retry mark while the sibling cells still fill (partial)', async () => {
    render(<KeywordsTable rows={rows} analysisId={ID} eventSourceFactory={factory} />, {
      wrapper: wrapper(),
    });
    fireEvent.click(screen.getByRole('button', { name: BATCH_LABEL }));
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));

    // The middle keyword fails; the others succeed.
    act(() =>
      FakeEventSource.last().emit('progress', {
        normalizedText: 'cheap running shoes',
        error: 'llm_timeout',
      }),
    );
    act(() =>
      FakeEventSource.last().emit('progress', {
        normalizedText: 'running shoes',
        summary: '導購型摘要',
      }),
    );
    act(() =>
      FakeEventSource.last().emit('progress', {
        normalizedText: 'best trail shoes',
        summary: '資訊型摘要',
      }),
    );

    // The failing cell shows a retry affordance; its siblings show their summaries — unpolluted.
    await waitFor(() =>
      expect(within(aiCellOf('cheap running shoes')).getByRole('button', { name: /重試/ })).toBeInTheDocument(),
    );
    expect(within(aiCellOf('running shoes')).getByText('導購型摘要')).toBeInTheDocument();
    expect(within(aiCellOf('best trail shoes')).getByText('資訊型摘要')).toBeInTheDocument();
  });

  it('when the batch completes, the header settles into a non-interactive done ✦ (one-way, no re-trigger)', async () => {
    render(<KeywordsTable rows={rows} analysisId={ID} eventSourceFactory={factory} />, {
      wrapper: wrapper(),
    });
    fireEvent.click(screen.getByRole('button', { name: BATCH_LABEL }));
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));

    act(() => {
      for (const k of ['running shoes', 'cheap running shoes', 'best trail shoes']) {
        FakeEventSource.last().emit('progress', { normalizedText: k, summary: `${k} 摘要` });
      }
      FakeEventSource.last().emit('completed', {});
    });

    // Generation is one-way: no batch trigger and no spinner remain.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: BATCH_LABEL })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('status', { name: '批次生成中' })).not.toBeInTheDocument();
  });

  it('a whole-job SSE failure surfaces a retry on the column header (batch-level error)', async () => {
    render(<KeywordsTable rows={rows} analysisId={ID} eventSourceFactory={factory} />, {
      wrapper: wrapper(),
    });
    fireEvent.click(screen.getByRole('button', { name: BATCH_LABEL }));
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));

    act(() => FakeEventSource.last().emit('failed', { error: 'boom' }));

    const retry = await screen.findByRole('button', { name: /批次生成失敗/ });
    // Retrying re-runs the whole-column job → a fresh stream opens.
    fireEvent.click(retry);
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(2));
  });
});

describe('TC-28 · batch ✦ generation is decoupled from the left-side view-gate (C13)', () => {
  it('running a header batch does NOT unlock the intent-topics dimension view (gate untouched)', async () => {
    let topicsPosted = false;
    server.use(
      http.post('/api/v1/keyword-analyses/:id/topics', () => {
        topicsPosted = true;
        return HttpResponse.json({ topicJobId: 'job-x' }, { status: 202 });
      }),
    );
    render(
      <>
        <KeywordsTable rows={rows} analysisId={ID} eventSourceFactory={factory} />
        <IntentTopicsView analysisId={ID} features={{}} eventSourceFactory={factory} />
      </>,
      { wrapper: wrapper() },
    );

    // Precondition: the topics view shows its gate CTA, not the 主題表.
    expect(screen.getByText(/尚未進行意圖主題分析/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: BATCH_LABEL }));
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    act(() =>
      FakeEventSource.last().emit('progress', { normalizedText: 'running shoes', summary: '摘要' }),
    );
    await waitFor(() =>
      expect(within(aiCellOf('running shoes')).getByText('摘要')).toBeInTheDocument(),
    );

    // C13: the dimension view-gate is unchanged — still the CTA, and no topics run was started.
    expect(screen.getByText(/尚未進行意圖主題分析/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: '意圖主題表' })).not.toBeInTheDocument();
    expect(topicsPosted).toBe(false);
  });
});
