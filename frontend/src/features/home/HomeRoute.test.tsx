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
import { server } from '../../api/msw/server';
import { deserialize } from '../../lib/urlState';
import { HomeRoute } from './HomeRoute';

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/**
 * Mount HomeRoute inside a memory-history TanStack Router (root owns the same
 * `deserialize` search codec as the app) + a TanStack Query provider (the T1.3
 * job-tracking panel needs one once an analysisId is present), so
 * `router.state.location.search` reflects real navigation. Returns the router
 * for post-submit URL assertions.
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
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
            fields: { geo: ['地區為必填'], seeds: ['至少一個種子字'], language: ['語言格式錯誤'] },
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
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: '建立分析' }));

    expect(await screen.findByText('地區為必填')).toBeInTheDocument();
    expect(screen.getByText('至少一個種子字')).toBeInTheDocument();
    // language 欄亦有 field error → aria-invalid 分支（inline 錯誤三欄皆走到）。
    expect(screen.getByText('語言格式錯誤')).toBeInTheDocument();
    expect(screen.getByLabelText('語言 (language)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not POST when the form is submitted while invalid (guard)', async () => {
    let called = false;
    server.use(
      http.post('/api/v1/keyword-analyses', () => {
        called = true;
        return HttpResponse.json({ analysisId: ANALYSIS_ID }, { status: 202 });
      }),
    );
    renderHome();
    // 空 seeds/geo/language → 不可送出；直接 submit form（模擬 Enter/程式化送出，繞過 disabled 按鈕）。
    fireEvent.submit(await screen.findByRole('form', { name: '建立分析' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(called).toBe(false); // handleSubmit 的 !isSubmittable 早退（不打後端）
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
      // The create flow now navigates into the AnalysisDashboard (T6.0), which reads
      // the authoritative `GET :id` snapshot for readiness — a still-running one keeps
      // the job-tracking progress panel.
      http.get('/api/v1/keyword-analyses/:id', () => HttpResponse.json({ status: 'running' })),
    );
    const router = renderHome();

    fireEvent.change(await screen.findByLabelText('種子關鍵字'), {
      target: { value: 'running shoes\ntrail shoes' },
    });
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'TW' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'zh-TW' } });
    fireEvent.click(screen.getByRole('button', { name: '建立分析' }));

    await waitFor(() => {
      // The analysis (geo, language) context rides along in the URL (Design §5) so the
      // ready 搜尋詞總表 can seed list-layer-fixed tracking selections (FR-19).
      expect(router.state.location.search).toEqual({
        analysisId: ANALYSIS_ID,
        geo: 'TW',
        language: 'zh-TW',
      });
    });
    expect(received).toMatchObject({
      seeds: ['running shoes', 'trail shoes'],
      geo: 'TW',
      language: 'zh-TW',
      mode: 'expand',
    });
    // After navigation the home route swaps the form for the analysis dashboard;
    // a still-running snapshot shows the job-tracking progress panel (queued →
    // progress view; SSE is the inert test stub, so it stays put).
    expect(await screen.findByText('分析進行中')).toBeInTheDocument();
  });

  it('wires the optional mode / network / includeAdult controls into the body', async () => {
    let received: unknown;
    server.use(
      http.post('/api/v1/keyword-analyses', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ analysisId: ANALYSIS_ID }, { status: 202 });
      }),
      // Post-navigation dashboard readiness probe (see above).
      http.get('/api/v1/keyword-analyses/:id', () => HttpResponse.json({ status: 'running' })),
    );
    renderHome();

    fireEvent.change(await screen.findByLabelText('種子關鍵字'), { target: { value: 'shoes' } });
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'US' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'en' } });
    fireEvent.click(screen.getByLabelText('精準 (exact)'));
    fireEvent.change(screen.getByLabelText('搜尋網路 (network)'), {
      target: { value: 'GOOGLE_SEARCH_AND_PARTNERS' },
    });
    fireEvent.click(screen.getByLabelText('包含成人內容 (includeAdult)'));
    fireEvent.click(screen.getByRole('button', { name: '建立分析' }));

    await waitFor(() => {
      expect(received).toEqual({
        seeds: ['shoes'],
        geo: 'US',
        language: 'en',
        mode: 'exact',
        network: 'GOOGLE_SEARCH_AND_PARTNERS',
        includeAdult: true,
      });
    });
  });

  it('surfaces a generic error when a failure has no field-level messages', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses', () =>
        HttpResponse.json({ nope: true }, { status: 500 }),
      ),
    );
    renderHome();

    fireEvent.change(await screen.findByLabelText('種子關鍵字'), { target: { value: 'shoes' } });
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'TW' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'zh-TW' } });
    fireEvent.click(screen.getByRole('button', { name: '建立分析' }));

    expect(await screen.findByText('建立分析失敗，請稍後再試。')).toBeInTheDocument();
    // Non-terminal failure: still on the form (no navigation), CTA re-enabled.
    expect(screen.getByRole('button', { name: '建立分析' })).toBeEnabled();
  });
});

describe('TC-31 · AI ideation append into seeds (no auto-create)', () => {
  it('generates from the existing seeds and appends de-duplicated, without creating an analysis', async () => {
    let received: unknown;
    server.use(
      http.post('/api/v1/ai-ideation', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(
          { keywords: ['trail shoes', 'Running Shoes', 'marathon'] },
          { status: 200 },
        );
      }),
    );
    const router = renderHome();

    const seeds = await screen.findByLabelText<HTMLTextAreaElement>('種子關鍵字');
    fireEvent.change(seeds, { target: { value: 'running shoes' } });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    // "Running Shoes" de-dupes against the existing "running shoes" (C7); the two
    // genuinely-new keywords append in order.
    await waitFor(() => expect(seeds.value).toBe('running shoes\ntrail shoes\nmarathon'));

    // The request seeds are the form's EXISTING seeds (FR-20 / AC-20.1 「現有 seeds」).
    expect(received).toEqual({ template: 'long-tail', seeds: ['running shoes'] });

    // 不自動建立分析：URL 無 analysisId、仍在建立表單。
    expect(router.state.location.search).not.toHaveProperty('analysisId');
    expect(screen.getByRole('button', { name: '建立分析' })).toBeInTheDocument();
  });
});
