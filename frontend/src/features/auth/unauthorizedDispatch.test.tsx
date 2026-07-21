import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { deserialize } from '../../lib/urlState';
import { HistoryView } from '../history/HistoryView';
import { useUnauthorizedRedirect } from './unauthorizedRedirect';

/**
 * TC-22 (401 → login dispatch, FR-11 / FR-12). A real view's protected data fetch
 * returning 401 must route through the shared auth interceptor
 * (`api/authInterceptor`) to the app-registered handler → /login redirect (session
 * expiry) — NOT a scary error state painted over the redirect. Wires
 * `useUnauthorizedRedirect` exactly as the RootLayout does and mounts a real view
 * (HistoryView) whose `GET /keyword-analyses` 401s via MSW.
 */
function RootWithRedirect() {
  useUnauthorizedRedirect();
  return <Outlet />;
}

function renderWithAuth() {
  const rootRoute = createRootRoute({ validateSearch: deserialize, component: RootWithRedirect });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Outlet });
  const historyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/history',
    component: HistoryView,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => <div>登入頁</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, historyRoute, loginRoute]),
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

describe('TC-22 · 401 dispatch (view fetch → auth interceptor → /login)', () => {
  it('redirects to /login when a protected view fetch returns 401 (session expiry)', async () => {
    server.use(http.get('/api/v1/keyword-analyses', () => new HttpResponse(null, { status: 401 })));
    const router = renderWithAuth();

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(await screen.findByText('登入頁')).toBeInTheDocument();
  });
});
