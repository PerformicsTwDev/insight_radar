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
import { describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { deserialize } from '../../lib/urlState';
import { ResultsLayout } from './ResultsLayout';

/**
 * ResultsLayout is the v4 shared results frame (M7-R17): the action row (返回搜尋首頁 +
 * filter chips + 隱藏 AI 洞察 + 輸出簡報) over the 3-column grid — 分析維度 menu (left) ·
 * centre `{children}` · AI 洞察 panel (right). These specs cover the chrome that moved
 * here from AppShell / KeywordsView: the metadata-driven dimension menu (TC-37), the
 * views-load degraded notice (TC-60), the 追蹤清單 nav (M7-R5), and the AI-panel toggle
 * (TC-59 / M7-R6). Router + Query + MSW harness; the AI panel is click-gated (M7-R14) so
 * it fires no request on mount.
 */

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const READY_FEATURES = { keyword_metrics: { status: 'ready' } };

function renderLayout(initialPath = '/?view=keywords', view: string | undefined = 'keywords') {
  const rootRoute = createRootRoute({ validateSearch: deserialize, component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <ResultsLayout analysisId={ANALYSIS_ID} view={view} features={READY_FEATURES}>
        <div>centre content</div>
      </ResultsLayout>
    ),
  });
  const trackingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/tracking/$listId',
    component: () => <div>tracking detail</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, trackingRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('TC-37 · ResultsLayout dimension menu (metadata-driven)', () => {
  it('renders one dimension button per registry view, active view marked (AC-1.2)', async () => {
    renderLayout('/?view=keywords');
    const menu = await screen.findByRole('navigation', { name: '維度選單' });
    expect(menu).toBeInTheDocument();
    const active = await screen.findByRole('button', { name: '搜尋詞總表' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('button', { name: '意圖主題' })).toBeInTheDocument();
  });

  it('selecting a dimension switches the URL view (T6.0)', async () => {
    const router = renderLayout('/?view=keywords');
    fireEvent.click(await screen.findByRole('button', { name: '意圖主題' }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ view: 'intent_topics' }),
    );
  });
});

describe('M7-R22 · filter bar gated to filter-applying views (xhigh [3/11])', () => {
  it('renders the filter chips bar on the 搜尋詞總表 (keywords) view', async () => {
    renderLayout('/?view=keywords', 'keywords');
    expect(await screen.findByRole('group', { name: '篩選' })).toBeInTheDocument();
  });

  it('does NOT render the inert filter bar on a non-keyword dimension view (they ignore filters)', async () => {
    renderLayout('/?view=journey', 'journey');
    // The shared frame still mounts (menu present) — but the filter bar must not, since the
    // journey/intent/custom views never read s.filters (would be a no-op control + AI mis-key).
    await screen.findByRole('navigation', { name: '維度選單' });
    expect(screen.queryByRole('group', { name: '篩選' })).not.toBeInTheDocument();
  });
});

describe('TC-60 · views-load degraded notice (T7.5)', () => {
  it('shows the fallback notice when GET /views fails', async () => {
    server.use(http.get('/api/v1/views', () => new HttpResponse(null, { status: 500 })));
    renderLayout();
    expect(await screen.findByText(/無法載入視圖清單/)).toBeInTheDocument();
  });

  it('shows no notice when GET /views succeeds', async () => {
    renderLayout();
    await screen.findByRole('navigation', { name: '維度選單' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText(/無法載入視圖清單/)).not.toBeInTheDocument();
  });
});

describe('M7-R5 · left-column 追蹤清單 nav', () => {
  it('navigates to a list detail when its left-nav entry is clicked', async () => {
    server.use(
      http.get('/api/v1/tracking-lists', () =>
        HttpResponse.json([
          {
            listId: 'l1',
            name: '競品觀察清單',
            geo: 'geoTargetConstants/2158',
            language: 'languageConstants/1018',
            createdAt: '2026-01-01T00:00:00.000Z',
            memberCount: 3,
          },
        ]),
      ),
    );
    const router = renderLayout();
    fireEvent.click(await screen.findByRole('button', { name: /競品觀察清單/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tracking/l1'));
  });
});

describe('TC-59 / M7-R6 · action row + AI 洞察 panel toggle', () => {
  it('renders the action row (返回搜尋首頁 + 輸出簡報) and the AI 洞察 side-panel', async () => {
    renderLayout();
    expect(await screen.findByRole('button', { name: /返回搜尋首頁/ })).toBeInTheDocument();
    // 輸出簡報 is a roadmap feature — present but disabled (M7-R24), not a live-looking dead control.
    expect(screen.getByRole('button', { name: '輸出簡報' })).toBeDisabled();
    expect(screen.getByRole('complementary', { name: 'AI 洞察側欄' })).toBeInTheDocument();
  });

  it('the 隱藏/顯示 AI 洞察 toggle collapses and re-expands the panel (M7-R6)', async () => {
    renderLayout();
    const hide = await screen.findByRole('button', { name: /隱藏 AI 洞察/ });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(hide);
    expect(screen.getByRole('button', { name: /顯示 AI 洞察/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('返回搜尋首頁 clears the analysis context (T7.9)', async () => {
    const router = renderLayout('/?analysisId=x&view=keywords');
    fireEvent.click(await screen.findByRole('button', { name: /返回搜尋首頁/ }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('analysisId'));
  });
});
