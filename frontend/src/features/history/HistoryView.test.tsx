import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { deserialize } from '../../lib/urlState';
import { HistoryView } from './HistoryView';

/**
 * TC-21 (component) — 分析歷史清單 + reopen (T3.5, FR-10 / AC-10.1). Mounts
 * HistoryView at `/history` inside a memory-history router (root owns the app's
 * `deserialize` codec, and an index route is the reopen target) so real navigation
 * is observable via `router.state.location`.
 */
const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const ROW = {
  analysisId: ANALYSIS_ID,
  status: 'completed',
  seeds: ['running shoes'],
  params: { mode: 'expand', geo: 'TW', language: 'zh-TW' },
  createdAt: '2026-07-10T08:00:00.000Z',
  finishedAt: '2026-07-10T08:05:00.000Z',
  resultSnapshotId: 'snap-1',
  count: 3686,
};

function renderHistory() {
  const rootRoute = createRootRoute({ validateSearch: deserialize, component: Outlet });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Outlet });
  const historyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/history',
    component: HistoryView,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, historyRoute]),
    history: createMemoryHistory({ initialEntries: ['/history'] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('TC-21 · HistoryView (分析歷史清單 + reopen)', () => {
  it('renders a row per past analysis with its params + count', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses', () =>
        HttpResponse.json({ data: [ROW], meta: { total: 1, page: 1, pageSize: 25 } }),
      ),
    );
    renderHistory();

    expect(await screen.findByText(/running shoes/)).toBeInTheDocument();
    expect(screen.getByText(/3,686/)).toBeInTheDocument();
    expect(screen.getByText(/TW/)).toBeInTheDocument();
  });

  it('reopens a row → navigates to the dashboard with its analysisId (URL restore, FR-1)', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses', () =>
        HttpResponse.json({ data: [ROW], meta: { total: 1, page: 1, pageSize: 25 } }),
      ),
    );
    const router = renderHistory();

    const reopen = await screen.findByRole('button', { name: /開啟/ });
    fireEvent.click(reopen);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.location.search).toMatchObject({ analysisId: ANALYSIS_ID });
  });

  it('shows an empty state when there are no past analyses', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses', () =>
        HttpResponse.json({ data: [], meta: { total: 0, page: 1, pageSize: 25 } }),
      ),
    );
    renderHistory();

    expect(await screen.findByText(/尚無分析紀錄/)).toBeInTheDocument();
  });

  it('status filter restricts to the valid enum and refetches with the chosen status', async () => {
    const statuses: (string | null)[] = [];
    server.use(
      http.get('/api/v1/keyword-analyses', ({ request }) => {
        statuses.push(new URL(request.url).searchParams.get('status'));
        return HttpResponse.json({ data: [ROW], meta: { total: 1, page: 1, pageSize: 25 } });
      }),
    );
    renderHistory();

    await screen.findByText(/running shoes/);
    fireEvent.change(screen.getByRole('combobox', { name: /狀態/ }), {
      target: { value: 'failed' },
    });

    await waitFor(() => expect(statuses).toContain('failed'));
    // First fetch has no status filter (全部); the enum-restricted select drives the rest.
    expect(statuses[0]).toBeNull();
  });
});
