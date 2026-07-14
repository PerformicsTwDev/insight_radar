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
import { server } from '../../api/msw/server';
import { deserialize } from '../../lib/urlState';
import { HomeRoute } from './HomeRoute';

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/**
 * Mount HomeRoute inside a memory-history TanStack Router (root owns the same
 * `deserialize` search codec as the app) so `router.state.location.search`
 * reflects real navigation. Returns the router for post-submit URL assertions.
 */
function renderHome() {
  const rootRoute = createRootRoute({ validateSearch: deserialize, component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: HomeRoute,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('TC-13 · HomeRoute create-analysis form (validation + inline field errors)', () => {
  it('disables the CTA until seeds + geo + language are all filled', async () => {
    renderHome();
    const cta = await screen.findByRole('button', { name: '建立分析' });
    expect(cta).toBeDisabled();

    fireEvent.change(screen.getByLabelText('種子關鍵字'), { target: { value: 'running shoes' } });
    expect(cta).toBeDisabled(); // geo + language still empty

    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'TW' } });
    expect(cta).toBeDisabled(); // language still empty

    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'zh-TW' } });
    expect(cta).toBeEnabled();
  });

  it('renders inline per-field errors from a 400 ErrorResponse.fields body', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            code: 'VALIDATION',
            message: 'Validation failed',
            fields: { geo: ['地區為必填'], seeds: ['至少一個種子字'] },
            path: '/api/v1/keyword-analyses',
            timestamp: '2026-07-14T00:00:00.000Z',
          },
          { status: 400 },
        ),
      ),
    );
    renderHome();

    fireEvent.change(await screen.findByLabelText('種子關鍵字'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'ZZ' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'zh-TW' } });
    fireEvent.click(screen.getByRole('button', { name: '建立分析' }));

    expect(await screen.findByText('地區為必填')).toBeInTheDocument();
    expect(screen.getByText('至少一個種子字')).toBeInTheDocument();
  });
});

describe('TC-32 · HomeRoute submit (POST 202 → navigate with analysisId)', () => {
  it('submits the typed body and navigates to the analysisId URL on 202', async () => {
    let received: unknown;
    server.use(
      http.post('/api/v1/keyword-analyses', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ analysisId: ANALYSIS_ID }, { status: 202 });
      }),
    );
    const router = renderHome();

    fireEvent.change(await screen.findByLabelText('種子關鍵字'), {
      target: { value: 'running shoes\ntrail shoes' },
    });
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'TW' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'zh-TW' } });
    fireEvent.click(screen.getByRole('button', { name: '建立分析' }));

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ analysisId: ANALYSIS_ID });
    });
    expect(received).toMatchObject({
      seeds: ['running shoes', 'trail shoes'],
      geo: 'TW',
      language: 'zh-TW',
      mode: 'expand',
    });
    // After navigation the home route shows the T1.3 progress placeholder.
    expect(await screen.findByText(/進度將於 T1\.3 上線/)).toBeInTheDocument();
  });
});
