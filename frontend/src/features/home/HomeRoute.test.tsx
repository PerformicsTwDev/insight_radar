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

/** v4: geo/language/network/includeAdult live behind the ⚙ 進階選項 toggle (T7.2). */
function openAdvanced() {
  fireEvent.click(screen.getByRole('button', { name: '進階選項' }));
}

describe('TC-13 · HomeRoute create-analysis form (validation + inline field errors)', () => {
  it('disables the CTA until seeds + geo + language are all filled (geo/language behind ⚙)', async () => {
    renderHome();
    const cta = await screen.findByRole('button', { name: '開始分析' });
    expect(cta).toBeDisabled();

    fireEvent.change(screen.getByLabelText('輸入搜尋詞'), { target: { value: 'running shoes' } });
    expect(cta).toBeDisabled(); // geo + language still empty (collapsed but still required)

    openAdvanced();
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

    fireEvent.change(await screen.findByLabelText('輸入搜尋詞'), { target: { value: 'x' } });
    openAdvanced();
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'ZZ' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

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
  it('submits the typed body (v4 default mode = exact) and navigates on 202', async () => {
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

    fireEvent.change(await screen.findByLabelText('輸入搜尋詞'), {
      target: { value: 'running shoes\ntrail shoes' },
    });
    openAdvanced();
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'TW' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'zh-TW' } });
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

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
      mode: 'exact', // v4 default 探索模式 = 指定模式 (exact)
    });
    // After navigation the home route swaps the form for the analysis dashboard;
    // a still-running snapshot shows the job-tracking progress panel.
    expect(await screen.findByText('分析進行中')).toBeInTheDocument();
  });

  it('wires the explore-mode pill + network + includeAdult into the body', async () => {
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

    fireEvent.change(await screen.findByLabelText('輸入搜尋詞'), { target: { value: 'shoes' } });
    fireEvent.click(screen.getByRole('button', { name: '拓展模式' })); // exact (default) → expand
    openAdvanced();
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'US' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'en' } });
    fireEvent.change(screen.getByLabelText('搜尋網路 (network)'), {
      target: { value: 'GOOGLE_SEARCH_AND_PARTNERS' },
    });
    fireEvent.click(screen.getByLabelText('包含成人內容 (includeAdult)'));
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

    await waitFor(() => {
      expect(received).toEqual({
        seeds: ['shoes'],
        geo: 'US',
        language: 'en',
        mode: 'expand',
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

    fireEvent.change(await screen.findByLabelText('輸入搜尋詞'), { target: { value: 'shoes' } });
    openAdvanced();
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'TW' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'zh-TW' } });
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

    expect(await screen.findByText('建立分析失敗，請稍後再試。')).toBeInTheDocument();
    // Non-terminal failure: still on the form (no navigation), CTA re-enabled.
    expect(screen.getByRole('button', { name: '開始分析' })).toBeEnabled();
  });
});

describe('TC-57 · Home v4 (探索模式 pills + ⚙ 進階 collapsible + Import roadmap chips)', () => {
  it('defaults 探索模式 to 指定模式 (exact) and toggles to 拓展模式 (expand) with helper copy', async () => {
    renderHome();
    const exact = await screen.findByRole('button', { name: '指定模式' });
    expect(exact).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '拓展模式' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText(/精準分析上方輸入的搜尋詞/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '拓展模式' }));
    expect(screen.getByRole('button', { name: '拓展模式' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/擴充相關關鍵字/)).toBeInTheDocument();
  });

  it('hides the Google Ads params behind the ⚙ 進階選項 toggle (collapsed by default)', async () => {
    renderHome();
    await screen.findByLabelText('輸入搜尋詞');
    expect(screen.queryByLabelText('地區 (geo)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('語言 (language)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('搜尋網路 (network)')).not.toBeInTheDocument();

    openAdvanced();
    expect(screen.getByLabelText('地區 (geo)')).toBeInTheDocument();
    expect(screen.getByLabelText('語言 (language)')).toBeInTheDocument();
    expect(screen.getByLabelText('搜尋網路 (network)')).toBeInTheDocument();
  });

  it('keeps geo/language required while collapsed: CTA disabled with a ⚙-pointing hint', async () => {
    renderHome();
    fireEvent.change(await screen.findByLabelText('輸入搜尋詞'), { target: { value: 'shoes' } });
    expect(screen.getByRole('button', { name: '開始分析' })).toBeDisabled();
    // Hint names the missing required fields and points at the collapsed advanced section.
    expect(screen.getByText(/進階選項/)).toBeInTheDocument();
  });

  it('renders Import From GAD/GSC as roadmap chips: click shows 即將推出 and fires NO request', async () => {
    let posted = false;
    server.use(
      http.post('/api/v1/keyword-analyses', () => {
        posted = true;
        return HttpResponse.json({ analysisId: ANALYSIS_ID }, { status: 202 });
      }),
    );
    renderHome();
    await screen.findByLabelText('輸入搜尋詞');
    expect(screen.queryByText('即將推出')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Import From GAD' }));
    expect(screen.getByRole('status')).toHaveTextContent('即將推出');
    fireEvent.click(screen.getByRole('button', { name: 'Import From GSC' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(posted).toBe(false); // roadmap chips never hit the backend
  });

  it('auto-expands the advanced section when a 400 targets a collapsed field (geo)', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            code: 'VALIDATION',
            message: 'Validation failed',
            fields: { geo: ['地區為必填'] },
            path: '/api/v1/keyword-analyses',
            timestamp: '2026-07-14T00:00:00.000Z',
          },
          { status: 400 },
        ),
      ),
    );
    renderHome();

    fireEvent.change(await screen.findByLabelText('輸入搜尋詞'), { target: { value: 'shoes' } });
    openAdvanced();
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'ZZ' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'zh-TW' } });
    openAdvanced(); // collapse again — the field stays filled (state persists) but hidden
    expect(screen.queryByLabelText('地區 (geo)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

    // The 400 targets the collapsed geo field → the section auto-expands so the error shows.
    expect(await screen.findByText('地區為必填')).toBeInTheDocument();
    expect(screen.getByLabelText('地區 (geo)')).toBeInTheDocument();
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

    const seeds = await screen.findByLabelText<HTMLTextAreaElement>('輸入搜尋詞');
    fireEvent.change(seeds, { target: { value: 'running shoes' } });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    // "Running Shoes" de-dupes against the existing "running shoes" (C7); the two
    // genuinely-new keywords append in order.
    await waitFor(() => expect(seeds.value).toBe('running shoes\ntrail shoes\nmarathon'));

    // The request seeds are the form's EXISTING seeds (FR-20 / AC-20.1 「現有 seeds」).
    expect(received).toEqual({ template: 'long-tail', seeds: ['running shoes'] });

    // 不自動建立分析：URL 無 analysisId、仍在建立表單。
    expect(router.state.location.search).not.toHaveProperty('analysisId');
    expect(screen.getByRole('button', { name: '開始分析' })).toBeInTheDocument();
  });
});
