import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../api/msw/server';
import { deserialize } from '../../lib/urlState';
import { ViewContent, type ViewContentProps } from './ViewContent';

// jsdom cannot acquire a canvas 2D context; stub Chart.js so the trend view mounts
// without noise (the presentational chart is covered by TrendChart / TrendView tests).
vi.mock('chart.js', () => {
  class Chart {
    static register(): void {}
    destroy(): void {}
  }
  return { Chart, registerables: [] };
});

/**
 * TC-11 / TC-37 (FR-1 / AC-1.2) — the registry-driven view→content router. Mounts
 * {@link ViewContent} in a memory-history TanStack Router (so the standalone views'
 * router hooks resolve) + a Query provider (`useViews` + per-view data). The known
 * view set comes from the default MSW `GET /views` (T3.1 registry), never a
 * hardcoded list: a known view → its standalone component; a `custom:{cid}` →
 * the custom-classification view; an unknown-but-valid string → a non-blank
 * not-found (the FR-1 boundary), never a crash / blank page.
 */

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const QUERY_ROUTE = '/api/v1/keyword-analyses/:id/query';

/**
 * View-aware `POST /query` handler (M7-R1): the 搜尋詞總表 now reads via the view-router, and the
 * keywords view co-mounts a 趨勢 card firing its own `view:'trend'` request — keep it healthy (empty
 * axis) while the keywords view returns one row (raw `intent`, mapped to `intentLabels` by the egress).
 */
function keywordsHandler() {
  return http.post(QUERY_ROUTE, async ({ request }) => {
    const { view } = (await request.json()) as { view: string };
    if (view === 'trend') {
      return HttpResponse.json({ view: 'trend', axis: [], total: [], series: [] });
    }
    return HttpResponse.json({
      view: 'keywords',
      columns: [],
      rows: [
        {
          text: 'running shoes',
          normalizedText: 'running shoes',
          intent: ['commercial'],
          avgMonthlySearches: 1000,
          competition: 'HIGH',
          competitionIndex: 80,
          cpcLow: 0.5,
          cpcHigh: 1.5,
          monthlyVolumes: [],
        },
      ],
      pagination: { total: 1, page: 1, pageSize: 25, cursor: null },
    });
  });
}

function renderView(props: Partial<ViewContentProps> = {}) {
  const rootRoute = createRootRoute({ validateSearch: deserialize, component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <ViewContent
        analysisId={ANALYSIS_ID}
        view={props.view}
        features={props.features ?? undefined}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('ViewContent · registry-driven view resolution (FR-1 / AC-1.2)', () => {
  it('renders the keywords grand table for the default (no) view', async () => {
    server.use(keywordsHandler());
    renderView({ view: undefined });
    expect(await screen.findByRole('table', { name: '搜尋詞總表' })).toBeInTheDocument();
    expect(await screen.findByText('running shoes')).toBeInTheDocument();
  });

  it('renders the keywords table for view=keywords (known registry view)', async () => {
    server.use(keywordsHandler());
    renderView({ view: 'keywords' });
    expect(await screen.findByRole('table', { name: '搜尋詞總表' })).toBeInTheDocument();
  });

  it('renders the trend chart for view=trend', async () => {
    server.use(
      http.post(QUERY_ROUTE, () =>
        HttpResponse.json({
          view: 'trend',
          axis: ['2026-01', '2026-02'],
          total: [100, 120],
          series: [],
        }),
      ),
    );
    renderView({ view: 'trend' });
    expect(await screen.findByRole('img', { name: '搜尋趨勢折線圖' })).toBeInTheDocument();
  });

  it('renders the intent-topics gate for view=intent_topics (features not_generated)', async () => {
    renderView({ view: 'intent_topics', features: { topics: { status: 'not_generated' } } });
    expect(await screen.findByText('尚未進行意圖主題分析')).toBeInTheDocument();
  });

  it('renders the journey gate for view=journey (features not_generated)', async () => {
    renderView({ view: 'journey', features: { journey: { status: 'not_generated' } } });
    expect(await screen.findByText('尚未進行購買歷程分析')).toBeInTheDocument();
  });

  it('maps view=journey_funnel to the journey view (both share the journey feature)', async () => {
    renderView({ view: 'journey_funnel', features: { journey: { status: 'not_generated' } } });
    expect(await screen.findByText('尚未進行購買歷程分析')).toBeInTheDocument();
  });

  it('opens view=journey_funnel directly on the 漏斗圖 (T6.3 golden / AC-1.1)', async () => {
    server.use(
      http.post(QUERY_ROUTE, () =>
        HttpResponse.json({
          view: 'journey',
          columns: [
            { key: 'text', label: '關鍵字', type: 'text' },
            { key: 'stage', label: '購買歷程階段', type: 'text' },
          ],
          rows: [{ text: 'iphone 16 vs 15 pro', stage: 'spec_comparison' }],
          pagination: { total: 1, page: 1, pageSize: 25, cursor: null },
        }),
      ),
      http.get('/api/v1/keyword-analyses/:id/journey', () =>
        HttpResponse.json({
          journeyJobId: 'run-1',
          status: 'completed',
          progress: null,
          keywordCount: 1,
        }),
      ),
    );
    renderView({ view: 'journey_funnel', features: { journey: { status: 'ready' } } });
    expect(await screen.findByRole('img', { name: '購買歷程搜尋漏斗' })).toBeInTheDocument();
  });

  it('opens view=journey directly on the 購買歷程表 (default 表格)', async () => {
    server.use(
      http.post(QUERY_ROUTE, () =>
        HttpResponse.json({
          view: 'journey',
          columns: [
            { key: 'text', label: '關鍵字', type: 'text' },
            { key: 'stage', label: '購買歷程階段', type: 'text' },
          ],
          rows: [{ text: 'iphone 16 vs 15 pro', stage: 'spec_comparison' }],
          pagination: { total: 1, page: 1, pageSize: 25, cursor: null },
        }),
      ),
      http.get('/api/v1/keyword-analyses/:id/journey', () =>
        HttpResponse.json({
          journeyJobId: 'run-1',
          status: 'completed',
          progress: null,
          keywordCount: 1,
        }),
      ),
    );
    renderView({ view: 'journey', features: { journey: { status: 'ready' } } });
    expect(await screen.findByRole('table', { name: '購買歷程表' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '購買歷程搜尋漏斗' })).not.toBeInTheDocument();
  });

  it('renders the custom-classification view for view=custom:{cid}', async () => {
    // A `custom:{cid}` deep-link seeds that cid's tab → its 分類表 fetches on mount
    // (`POST /query {view:'custom:{cid}'}`); stub it so the mount does not hit MSW's
    // unhandled-request guard. The add-entry is always present in the custom view.
    server.use(
      http.post(QUERY_ROUTE, () =>
        HttpResponse.json({
          view: 'custom:c-123',
          columns: [{ key: 'text', label: '關鍵字', type: 'text' }],
          rows: [],
          pagination: { total: 0, page: 1, pageSize: 25, cursor: null },
        }),
      ),
    );
    renderView({ view: 'custom:c-123' });
    expect(await screen.findByRole('button', { name: '+ 新增自訂分類' })).toBeInTheDocument();
  });

  it('restores the classification 分類表 for a view=custom:{cid} reopen (AC-1.2, #647)', async () => {
    // The FR-1/AC-1.2 reopen bug: resolveView yields {kind:'custom',cid} but the router
    // dropped `cid`, so a shared / reopened `?view=custom:{cid}` showed the empty
    // create-state instead of the classification's 表. The cid must thread through so the
    // 表 (off `POST /query {view:'custom:{cid}'}`) restores.
    server.use(
      http.post(QUERY_ROUTE, () =>
        HttpResponse.json({
          view: 'custom:c-123',
          columns: [
            { key: 'text', label: '關鍵字', type: 'text' },
            { key: 'label', label: '分類', type: 'text' },
          ],
          rows: [{ text: 'iphone 16', label: '價格導向' }],
          pagination: { total: 1, page: 1, pageSize: 25, cursor: null },
        }),
      ),
    );
    renderView({ view: 'custom:c-123' });
    expect(await screen.findByText('iphone 16')).toBeInTheDocument();
    expect(screen.queryByText(/尚未建立自訂分類/)).not.toBeInTheDocument();
  });

  it('renders a non-blank not-found state for an unknown-but-valid string view (FR-1)', async () => {
    renderView({ view: 'totally-bogus' });
    const notFound = await screen.findByRole('status', { name: '找不到視圖' });
    expect(notFound).toHaveTextContent('totally-bogus');
  });

  it('renders an "unavailable" state for a known view with no dashboard component yet', async () => {
    // `intent_distribution` is a registered backend view (chart shape) but has no
    // bespoke dashboard component — it is known (not not-found) → an explicit
    // "not yet available" state, distinct from the FR-1 unknown-view not-found.
    renderView({ view: 'intent_distribution' });
    expect(await screen.findByText(/尚未.*支援|尚未支援/)).toBeInTheDocument();
  });
});
