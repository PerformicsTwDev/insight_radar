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
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setUnauthorizedHandler } from '../../api/authInterceptor';
import { getKeywordAnalysisStatus } from '../../api/keywordAnalyses';
import { server } from '../../api/msw/server';
import { ApiKeyAuthProvider, getApiKey, type AuthProvider } from '../../lib/auth/authProvider';
import { LoginRoute } from './LoginRoute';
import { setPendingRedirect, useUnauthorizedRedirect } from './unauthorizedRedirect';

/**
 * TC-23 — login page + global 401 redirect + provider abstraction. Switching
 * `session`↔`apiKey` changes only the login page + provider; **business
 * components are unchanged** (the interceptor, not the views, enforces auth). The
 * frontend never reads a token: session login relies on the httpOnly cookie; the
 * apiKey path stores the transitional key in sessionStorage (never localStorage).
 */

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/** A business view that fires a protected request on mount (to trigger a global 401). */
function ProtectedView() {
  useEffect(() => {
    void getKeywordAnalysisStatus(UUID);
  }, []);
  return <div>protected-view</div>;
}

function renderApp(opts: {
  initialPath?: string;
  loginProvider?: AuthProvider;
  IndexComponent?: () => ReactNode;
}) {
  const rootRoute = createRootRoute({
    component: function Root() {
      useUnauthorizedRedirect();
      return <Outlet />;
    },
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: opts.IndexComponent ?? (() => <div>home</div>),
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: opts.loginProvider ? () => <LoginRoute provider={opts.loginProvider} /> : LoginRoute,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: [opts.initialPath ?? '/login'] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  sessionStorage.clear();
  setPendingRedirect(null);
});
afterEach(() => {
  setUnauthorizedHandler(null);
  setPendingRedirect(null);
  sessionStorage.clear();
});

describe('TC-23 · session login form', () => {
  it('renders email + password inputs (not an api-key input)', async () => {
    renderApp({});
    expect(await screen.findByLabelText('電子郵件')).toBeInTheDocument();
    expect(screen.getByLabelText('密碼')).toBeInTheDocument();
    expect(screen.queryByLabelText('API 金鑰')).not.toBeInTheDocument();
  });

  it('logs in and navigates home on success (no pending redirect → "/")', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json({ user: { id: 'u-1', email: 'user@example.com' } }, { status: 200 }),
      ),
    );
    const router = renderApp({});
    fireEvent.change(await screen.findByLabelText('電子郵件'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('returns to the captured deep link after login (pending redirect consumed)', async () => {
    setPendingRedirect(`/?analysisId=${UUID}`);
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json({ user: { id: 'u-1', email: 'user@example.com' } }, { status: 200 }),
      ),
    );
    const router = renderApp({});
    fireEvent.change(await screen.findByLabelText('電子郵件'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => expect(router.state.location.href).toContain(`analysisId=${UUID}`));
  });

  it('shows a generic error on 401 (no credential enumeration) and stays on /login', async () => {
    server.use(http.post('/api/v1/auth/login', () => new HttpResponse(null, { status: 401 })));
    const router = renderApp({});
    fireEvent.change(await screen.findByLabelText('電子郵件'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/登入失敗/);
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe('TC-23 · apiKey provider (business components unchanged)', () => {
  it('renders an api-key input (not email/password) and stores the key in sessionStorage', async () => {
    const router = renderApp({ loginProvider: new ApiKeyAuthProvider() });
    expect(await screen.findByLabelText('API 金鑰')).toBeInTheDocument();
    expect(screen.queryByLabelText('電子郵件')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('API 金鑰'), { target: { value: 'k-123' } });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(getApiKey()).toBe('k-123');
    expect(localStorage.length).toBe(0); // NFR-5: never localStorage
  });

  it('rejects an empty key with an error and does not navigate', async () => {
    const router = renderApp({ loginProvider: new ApiKeyAuthProvider() });
    fireEvent.click(await screen.findByRole('button', { name: '登入' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(getApiKey()).toBeNull();
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe('TC-23 · global 401 interception (redirect to /login)', () => {
  it('redirects to the login page when a business request returns 401', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id', () => new HttpResponse(null, { status: 401 })),
    );
    renderApp({ initialPath: '/', IndexComponent: ProtectedView });

    // Mounts the protected view → its GET 401s → interceptor redirects to /login.
    expect(await screen.findByLabelText('電子郵件')).toBeInTheDocument();
  });
});
