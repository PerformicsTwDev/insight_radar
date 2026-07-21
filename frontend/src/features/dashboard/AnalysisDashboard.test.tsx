import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { fetchTopicsStatus } from '../../api/topics';
import { server } from '../../api/msw/server';
import { deserialize } from '../../lib/urlState';
import { useJobTracking } from '../job/useJobTracking';
import { AnalysisDashboard } from './AnalysisDashboard';

/**
 * TC-11 / TC-14 (FR-1 / FR-3) — the analysis dashboard container. It reads the
 * authoritative `GET :id` snapshot to decide readiness + features: a ready
 * (completed/partial) analysis routes the active `view` to content (ViewContent);
 * a queued/running one shows the live job-tracking panel; a 404 (gone/expired/not
 * owner) shows an explicit not-found (FR-3), a transient failure shows a retry.
 * Mounted in a memory router (reads `view` from the URL) + a Query provider.
 */

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const STATUS_ROUTE = '/api/v1/keyword-analyses/:id';
const KEYWORDS_ROUTE = '/api/v1/keyword-analyses/:id/keywords';

function keywordsBody() {
  return {
    data: [
      {
        text: 'running shoes',
        intentLabels: [],
        avgMonthlySearches: 1000,
        competition: 'HIGH',
        competitionIndex: 80,
        cpcLow: 0.5,
        cpcHigh: 1.5,
        monthlyVolumes: [],
      },
    ],
    meta: { total: 1, page: 1, pageSize: 25, cursor: null },
  };
}

function renderDashboard(search = '') {
  const rootRoute = createRootRoute({ validateSearch: deserialize, component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <AnalysisDashboard analysisId={ANALYSIS_ID} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: [`/${search}`] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

/**
 * Controllable fake `EventSource` (jsdom has none; the setup stubs an inert one).
 * The §7 tests below swap this in so the live SSE stream `useJobTracking` opens
 * inside the rendered `JobTrackingPanel` can be driven (`emitOpen` / `emit`) and
 * observed (`closed`) — i.e. so a test can prove a transient dashboard `GET :id`
 * blip does NOT tear the healthy stream down.
 */
class FakeEventSource {
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
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    (this.listeners.get(type) ?? []).forEach((l) => l(event));
  }
}

/** Run `body` with the global `EventSource` swapped for the controllable fake, then restore. */
async function withFakeEventSource(body: () => Promise<void>): Promise<void> {
  const inert = globalThis.EventSource;
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  try {
    await body();
  } finally {
    vi.stubGlobal('EventSource', inert);
    FakeEventSource.instances = [];
  }
}

describe('AnalysisDashboard · readiness → content routing', () => {
  it('routes a completed analysis to the default keywords table', async () => {
    server.use(
      http.get(STATUS_ROUTE, () => HttpResponse.json({ status: 'completed', features: {} })),
      http.get(KEYWORDS_ROUTE, () => HttpResponse.json(keywordsBody())),
    );
    renderDashboard();
    expect(await screen.findByRole('table', { name: '搜尋詞總表' })).toBeInTheDocument();
  });

  it('routes a partial analysis to view content too (partial is viewable, C3)', async () => {
    server.use(
      http.get(STATUS_ROUTE, () => HttpResponse.json({ status: 'partial', features: {} })),
      http.get(KEYWORDS_ROUTE, () => HttpResponse.json(keywordsBody())),
    );
    renderDashboard();
    expect(await screen.findByRole('table', { name: '搜尋詞總表' })).toBeInTheDocument();
  });

  it('resolves the active view from the URL for a ready analysis (view=intent_topics)', async () => {
    server.use(
      http.get(STATUS_ROUTE, () =>
        HttpResponse.json({
          status: 'completed',
          features: { topics: { status: 'not_generated' } },
        }),
      ),
    );
    renderDashboard('?view=intent_topics');
    expect(await screen.findByText('尚未進行意圖主題分析')).toBeInTheDocument();
  });

  it('shows a non-blank not-found for an unknown view on a ready analysis (FR-1)', async () => {
    server.use(
      http.get(STATUS_ROUTE, () => HttpResponse.json({ status: 'completed', features: {} })),
    );
    renderDashboard('?view=bogus');
    expect(await screen.findByRole('status', { name: '找不到視圖' })).toHaveTextContent('bogus');
  });

  it('shows the live job-tracking progress while the analysis is still running', async () => {
    server.use(http.get(STATUS_ROUTE, () => HttpResponse.json({ status: 'running' })));
    renderDashboard();
    expect(await screen.findByText('分析進行中')).toBeInTheDocument();
  });

  it('shows an explicit not-found when the analysis is gone (GET :id 404, FR-3)', async () => {
    server.use(http.get(STATUS_ROUTE, () => new HttpResponse(null, { status: 404 })));
    renderDashboard();
    expect(await screen.findByText('找不到分析')).toBeInTheDocument();
  });

  it('shows a retry error on a transient status failure, and recovers on retry', async () => {
    let calls = 0;
    server.use(
      http.get(STATUS_ROUTE, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ status: 'running' });
      }),
    );
    renderDashboard();
    fireEvent.click(await screen.findByRole('button', { name: '重試' }));
    // Retry re-probes the snapshot → now running → the live progress panel.
    expect(await screen.findByText('分析進行中')).toBeInTheDocument();
  });
});

/**
 * M6-R1 / TC-22 (FR-1 · FR-3 · Design §7 「單一權威傳輸 / 訂閱去重」). A running analysis
 * tracked live via a healthy SSE stream must survive a transient `GET :id` blip: the
 * dashboard must NOT open a second, un-deduped poller that blanks the whole page
 * (`getKeywordAnalysisStatus` never throws — a transient 5xx resolves to a
 * `{kind:'unavailable'}` **success** value) and tears the healthy stream down. Instead
 * readiness is coordinated with the ONE `useJobTracking` transport (shared `['job',
 * analysisId]` state); a mid-run blip is non-blanking + non-halting and self-heals.
 */
describe('AnalysisDashboard · §7 single authoritative transport (M6-R1, TC-22)', () => {
  it('a mid-running GET :id blip keeps the live panel + SSE alive and self-heals (no manual retry)', async () => {
    await withFakeEventSource(async () => {
      let blip = false;
      server.use(
        http.get(STATUS_ROUTE, () =>
          blip
            ? new HttpResponse(null, { status: 500 })
            : HttpResponse.json({ status: 'running', progress: { percent: 30 } }),
        ),
      );
      const { queryClient } = renderDashboard();

      // The analysis is running and tracked live via a healthy SSE (progress ticking).
      expect(await screen.findByText('分析進行中')).toBeInTheDocument();
      const es = FakeEventSource.last();
      act(() => {
        es.emitOpen();
        es.emit('progress', { phase: 'expand', percent: 30 });
      });

      // The dashboard's own `GET :id` snapshot blips once (transient 5xx → unavailable).
      // The trailing tick flushes the query observer's deferred re-render so a failing
      // (blanking) dashboard has actually collapsed by the time we assert.
      const pollOnce = async () =>
        act(async () => {
          await queryClient.refetchQueries({ queryKey: ['analysis-status', ANALYSIS_ID] });
          await new Promise((r) => setTimeout(r, 0));
        });
      blip = true;
      await pollOnce();

      // Regression pin: it must NOT collapse to a full-page error; the live panel and
      // its SSE stream survive, so polling continues without a manual 重試.
      expect(screen.queryByRole('button', { name: '重試' })).not.toBeInTheDocument();
      expect(screen.getByText('分析進行中')).toBeInTheDocument();
      expect(es.closed).toBe(false);

      // The next successful poll recovers on its own — still the live panel, still open.
      blip = false;
      await pollOnce();
      expect(screen.getByText('分析進行中')).toBeInTheDocument();
      expect(es.closed).toBe(false);
    });
  });

  it('flips to view content off the shared live job-state when the run completes (§7 dedup)', async () => {
    await withFakeEventSource(async () => {
      let done = false;
      server.use(
        http.get(STATUS_ROUTE, () =>
          done
            ? HttpResponse.json({ status: 'completed', features: {}, result: { count: 2 } })
            : HttpResponse.json({ status: 'running' }),
        ),
        http.get(KEYWORDS_ROUTE, () => HttpResponse.json(keywordsBody())),
      );
      renderDashboard();

      expect(await screen.findByText('分析進行中')).toBeInTheDocument();
      const es = FakeEventSource.last();

      // The single live transport reports completion; its confirm `GET :id` settles the
      // shared `['job']` state → the dashboard catches up its features snapshot and
      // flips to content, WITHOUT a second parallel dashboard poller (§7).
      done = true;
      act(() => {
        es.emitOpen();
        es.emit('completed', { count: 2 });
      });
      expect(
        await screen.findByRole('table', { name: '搜尋詞總表' }, { timeout: 4000 }),
      ).toBeInTheDocument();
    });
  });

  it('shows not-found when the live transport confirms the id is gone (404) mid-track', async () => {
    await withFakeEventSource(async () => {
      let gone = false;
      server.use(
        http.get(STATUS_ROUTE, () =>
          gone ? new HttpResponse(null, { status: 404 }) : HttpResponse.json({ status: 'running' }),
        ),
      );
      renderDashboard();

      expect(await screen.findByText('分析進行中')).toBeInTheDocument();
      const es = FakeEventSource.last();
      gone = true;
      act(() => {
        es.emitOpen();
        es.emit('completed', { count: 1 }); // → confirming → confirm GET :id → 404 → not_found
      });
      // The dashboard's own not-found state (aria-label) — driven by the shared job-state.
      expect(
        await screen.findByRole('status', { name: '找不到分析' }, { timeout: 4000 }),
      ).toBeInTheDocument();
    });
  });

  it('a sub-job (topics) settling not_found does NOT flip a viewable dashboard (key scope)', async () => {
    await withFakeEventSource(async () => {
      server.use(
        http.get(STATUS_ROUTE, () => HttpResponse.json({ status: 'completed', features: {} })),
        http.get(KEYWORDS_ROUTE, () => HttpResponse.json(keywordsBody())),
        // The topics sub-resource is gone → fetchTopicsStatus maps its 404 → not_found.
        http.get(
          '/api/v1/keyword-analyses/:id/topics',
          () => new HttpResponse(null, { status: 404 }),
        ),
      );

      // A completed main analysis renders ViewContent; a topics sub-job tracker
      // (streamPath 'topics/stream', same analysisId) shares the ONE QueryClient —
      // exactly like IntentTopicsView inside ViewContent coexisting with the dashboard.
      const rootRoute = createRootRoute({ validateSearch: deserialize, component: Outlet });
      const indexRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => <AnalysisDashboard analysisId={ANALYSIS_ID} />,
      });
      const router = createRouter({
        routeTree: rootRoute.addChildren([indexRoute]),
        history: createMemoryHistory({ initialEntries: ['/'] }),
      });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      function TopicsSubJob(): null {
        useJobTracking(ANALYSIS_ID, {
          streamPath: 'topics/stream',
          statusFetcher: fetchTopicsStatus,
        });
        return null;
      }
      render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <TopicsSubJob />
        </QueryClientProvider>,
      );

      // The dashboard is viewable — the keywords table is shown.
      expect(await screen.findByRole('table', { name: '搜尋詞總表' })).toBeInTheDocument();

      // The topics sub-job settles not_found (its confirm GET :id/topics 404s).
      const es = FakeEventSource.last();
      act(() => {
        es.emitOpen();
        es.emit('completed', { count: 0 });
      });

      // Wait until the sub-job's not_found has been mirrored into the shared cache
      // (whichever key the code writes) — so the dashboard has had its chance to react.
      await waitFor(() => {
        const bare = queryClient.getQueryData<{ status?: string }>(['job', ANALYSIS_ID]);
        const scoped = queryClient.getQueryData<{ status?: string }>([
          'job',
          ANALYSIS_ID,
          'topics/stream',
        ]);
        expect(bare?.status ?? scoped?.status).toBe('not_found');
      });

      // Regression pin: a SUB-job's not_found must not blank the whole dashboard — the
      // main analysis is fine, so its ViewContent (the 搜尋詞總表) must survive.
      expect(screen.queryByText('找不到分析')).not.toBeInTheDocument();
      expect(screen.getByRole('table', { name: '搜尋詞總表' })).toBeInTheDocument();
    });
  });
});
