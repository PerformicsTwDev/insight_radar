import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { routeTree } from '../../router';

/**
 * TC-11 / TC-21 (FR-1 · AC-1.1 / AC-1.2) — view-content routing over the REAL app
 * route tree (RootLayout shell + HomeRoute → AnalysisDashboard), so the assertions
 * exercise the shipped router, the metadata-driven nav wiring and the URL-is-state
 * restore — not a copy. Reopening `analysisId+view+filters` restores the same
 * screen (AC-1.1); an unknown view lands on a non-blank not-found (FR-1); the left
 * dimension menu switches the view via the URL. All egress MSW-mocked.
 */

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const STATUS_ROUTE = '/api/v1/keyword-analyses/:id';
const QUERY_ROUTE = '/api/v1/keyword-analyses/:id/query';
const LIST_ROUTE = '/api/v1/keyword-analyses';

function completedStatus(features: Record<string, unknown> = {}) {
  return http.get(STATUS_ROUTE, () => HttpResponse.json({ status: 'completed', features }));
}

/**
 * View-aware `POST /query` handler (M7-R1): the 搜尋詞總表 now reads via the view-router, and the
 * co-mounted 趨勢 card fires its own `view:'trend'` request — keep it healthy (empty axis) while the
 * keywords view returns one row (raw `intent`, mapped to `intentLabels` by the egress).
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
          intent: [],
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

function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('view-content routing (FR-1 · AC-1.1 / AC-1.2)', () => {
  it('reopens analysisId+view → restores the same view content (AC-1.1)', async () => {
    server.use(completedStatus({ topics: { status: 'not_generated' } }));
    renderAt(`/?analysisId=${ANALYSIS_ID}&view=intent_topics`);
    expect(await screen.findByText('尚未進行意圖主題分析')).toBeInTheDocument();
  });

  it('reopens analysisId+view+filters → restores the view AND keeps the filters in the URL (AC-1.1)', async () => {
    server.use(completedStatus({ topics: { status: 'not_generated' } }));
    const router = renderAt(
      `/?analysisId=${ANALYSIS_ID}&view=intent_topics&filters=${encodeURIComponent('q~run')}`,
    );
    expect(await screen.findByText('尚未進行意圖主題分析')).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({
      analysisId: ANALYSIS_ID,
      view: 'intent_topics',
      filters: 'q~run',
    });
  });

  it('renders a non-blank not-found for an unknown-but-valid view (FR-1)', async () => {
    server.use(completedStatus());
    renderAt(`/?analysisId=${ANALYSIS_ID}&view=definitely-not-a-view`);
    const notFound = await screen.findByRole('status', { name: '找不到視圖' });
    expect(notFound).toHaveTextContent('definitely-not-a-view');
  });

  it('switches the active view from the left dimension menu (nav → URL → content)', async () => {
    server.use(completedStatus({ topics: { status: 'not_generated' } }), keywordsHandler());
    const router = renderAt(`/?analysisId=${ANALYSIS_ID}`);

    // Default (no view) → keywords table.
    expect(await screen.findByRole('table', { name: '搜尋詞總表' })).toBeInTheDocument();

    // Click the metadata-driven 意圖主題 dimension (now enabled — no longer all-disabled).
    fireEvent.click(await screen.findByRole('button', { name: '意圖主題' }));

    await waitFor(() => expect(router.state.location.search.view).toBe('intent_topics'));
    expect(await screen.findByText('尚未進行意圖主題分析')).toBeInTheDocument();
  });

  it('reopens a completed analysis from the history list back into its content', async () => {
    server.use(
      http.get(LIST_ROUTE, () =>
        HttpResponse.json({
          data: [
            {
              analysisId: ANALYSIS_ID,
              status: 'completed',
              seeds: ['running shoes'],
              params: { mode: 'expand', geo: 'TW', language: 'zh-TW' },
              createdAt: '2026-07-21T00:00:00.000Z',
              finishedAt: '2026-07-21T00:01:00.000Z',
              resultSnapshotId: 'snap-1',
              count: 42,
            },
          ],
          meta: { total: 1, page: 1, pageSize: 20 },
        }),
      ),
      completedStatus(),
      keywordsHandler(),
    );
    const router = renderAt('/history');

    fireEvent.click(await screen.findByRole('button', { name: '開啟' }));

    await waitFor(() => expect(router.state.location.search.analysisId).toBe(ANALYSIS_ID));
    expect(await screen.findByRole('table', { name: '搜尋詞總表' })).toBeInTheDocument();
  });
});
