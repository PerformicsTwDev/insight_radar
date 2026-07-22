import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../api/msw/server';
import { deserialize } from '../lib/urlState';
import { RootLayout } from './RootLayout';

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/**
 * TC-60 (T7.5, FR-1/11) — the app shell's "無法載入視圖清單" fallback notice is a
 * views-loading error and must only surface when an analysis is in context. On a
 * cold open (no `analysisId`) the left menu is disabled and there is nothing to
 * view, so a `GET /views` failure must NOT paint that misleading error; only when
 * an analysis is being viewed does the degraded fallback deserve a notice.
 */
function renderRoot(initialPath: string) {
  const rootRoute = createRootRoute({ validateSearch: deserialize, component: RootLayout });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <div>outlet</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('TC-60 · views-loading notice gated on analysis context (T7.5)', () => {
  it('does NOT show the views-load notice on cold open (no analysisId) even when GET /views fails', async () => {
    server.use(http.get('/api/v1/views', () => new HttpResponse(null, { status: 500 })));
    renderRoot('/');

    // Shell rendered; let the /views query settle to its degraded (failed) state.
    await screen.findByRole('navigation', { name: '主要分頁' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(screen.queryByText(/無法載入視圖清單/)).not.toBeInTheDocument();
  });

  it('shows the fallback notice when GET /views fails AND an analysis is in context', async () => {
    server.use(http.get('/api/v1/views', () => new HttpResponse(null, { status: 500 })));
    renderRoot(`/?analysisId=${ANALYSIS_ID}`);

    expect(await screen.findByText(/無法載入視圖清單/)).toBeInTheDocument();
  });

  it('shows no notice when GET /views succeeds, regardless of context', async () => {
    // default MSW handler serves /views 200 → not degraded.
    renderRoot(`/?analysisId=${ANALYSIS_ID}`);
    await screen.findByRole('navigation', { name: '主要分頁' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText(/無法載入視圖清單/)).not.toBeInTheDocument();
  });
});
