import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { deserialize } from '../../lib/urlState';
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
