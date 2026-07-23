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
import { beforeEach } from 'vitest';
import { server } from '../../api/msw/server';
import { config } from '../../config/env';
import { deserialize } from '../../lib/urlState';
import { useAnalysisSettingsStore } from '../../stores/analysisSettingsStore';
import { HomeRoute } from './HomeRoute';

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/**
 * Mount HomeRoute inside a memory-history TanStack Router (root owns the same
 * `deserialize` search codec as the app) + a TanStack Query provider, so
 * `router.state.location.search` reflects real navigation. Returns the router.
 */
function renderHome() {
  const rootRoute = createRootRoute({ validateSearch: deserialize, component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: HomeRoute,
  });
  // Stub /tracking so the 從追蹤清單繼續「查看更多」 navigation (T7.7) resolves in tests.
  const trackingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/tracking',
    component: () => <div>追蹤清單頁</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, trackingRoute]),
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

// geo/language now come from the persisted settings store (T7.9/T7.10) — reset to the
// config defaults (T7.12: Google Ads resource names 台灣/繁中) before each test.
beforeEach(() => {
  localStorage.clear();
  useAnalysisSettingsStore.setState({ geo: config.defaultGeo, language: config.defaultLanguage });
});

describe('TC-13 · HomeRoute create-analysis form (seeds gate + inline errors)', () => {
  it('disables the CTA until seeds are filled (geo/language come from settings)', async () => {
    renderHome();
    const cta = await screen.findByRole('button', { name: '開始分析' });
    expect(cta).toBeDisabled();

    fireEvent.change(screen.getByLabelText('輸入搜尋詞'), { target: { value: 'running shoes' } });
    // geo/language default TW/zh-TW from settings → seeds alone enables the CTA.
    expect(cta).toBeEnabled();
  });

  it('renders an inline seeds error from a 400 ErrorResponse.fields body', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            code: 'VALIDATION',
            message: 'Validation failed',
            fields: { seeds: ['至少一個種子字'] },
            path: '/api/v1/keyword-analyses',
            timestamp: '2026-07-14T00:00:00.000Z',
          },
          { status: 400 },
        ),
      ),
    );
    renderHome();

    fireEvent.change(await screen.findByLabelText('輸入搜尋詞'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

    expect(await screen.findByText('至少一個種子字')).toBeInTheDocument();
    expect(screen.getByLabelText('輸入搜尋詞')).toHaveAttribute('aria-invalid', 'true');
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
    fireEvent.submit(await screen.findByRole('form', { name: '建立分析' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(called).toBe(false); // handleSubmit 的 !isSubmittable 早退（不打後端）
  });
});

describe('TC-32/TC-75 · HomeRoute submit (POST 202 with settings geo/lang + fixed network/adult)', () => {
  it('submits the default settings geo/lang as Google Ads resource names, fixed network=partners + includeAdult=true, mode=exact', async () => {
    let received: unknown;
    server.use(
      http.post('/api/v1/keyword-analyses', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ analysisId: ANALYSIS_ID }, { status: 202 });
      }),
      http.get('/api/v1/keyword-analyses/:id', () => HttpResponse.json({ status: 'running' })),
    );
    const router = renderHome();

    fireEvent.change(await screen.findByLabelText('輸入搜尋詞'), {
      target: { value: 'running shoes\ntrail shoes' },
    });
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

    await waitFor(() => {
      expect(router.state.location.search).toEqual({
        analysisId: ANALYSIS_ID,
        geo: 'geoTargetConstants/2158',
        language: 'languageConstants/1018',
      });
    });
    expect(received).toEqual({
      seeds: ['running shoes', 'trail shoes'],
      geo: 'geoTargetConstants/2158', // T7.12: resource name (backend contract), not 'TW'
      language: 'languageConstants/1018',
      mode: 'exact', // v4 default 探索模式
      network: 'GOOGLE_SEARCH_AND_PARTNERS', // fixed (FR-2 修訂 c)
      includeAdult: true, // fixed
    });
    expect(await screen.findByText('分析進行中')).toBeInTheDocument();
  });

  it('adopts the changed settings geo/language and the explore-mode pill into the body', async () => {
    useAnalysisSettingsStore.setState({
      geo: 'geoTargetConstants/2840',
      language: 'languageConstants/1000',
    });
    let received: unknown;
    server.use(
      http.post('/api/v1/keyword-analyses', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ analysisId: ANALYSIS_ID }, { status: 202 });
      }),
      http.get('/api/v1/keyword-analyses/:id', () => HttpResponse.json({ status: 'running' })),
    );
    renderHome();

    fireEvent.change(await screen.findByLabelText('輸入搜尋詞'), { target: { value: 'shoes' } });
    fireEvent.click(screen.getByRole('button', { name: '拓展模式' })); // exact → expand
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

    await waitFor(() => {
      expect(received).toEqual({
        seeds: ['shoes'],
        geo: 'geoTargetConstants/2840',
        language: 'languageConstants/1000',
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
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

    expect(await screen.findByText('建立分析失敗，請稍後再試。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開始分析' })).toBeEnabled();
  });
});

describe('TC-73 · Home v4 slim (no gear / no advanced inputs / no Import)', () => {
  it('renders neither the ⚙ 進階選項 gear, the geo/language/network/includeAdult inputs, nor Import chips', async () => {
    renderHome();
    await screen.findByLabelText('輸入搜尋詞');

    expect(screen.queryByRole('button', { name: '進階選項' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('地區 (geo)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('語言 (language)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('搜尋網路 (network)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('包含成人內容 (includeAdult)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import From GAD' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import From GSC' })).not.toBeInTheDocument();
  });

  it('keeps the explore-mode pills (default 指定模式, toggles to 拓展模式)', async () => {
    renderHome();
    const exact = await screen.findByRole('button', { name: '指定模式' });
    expect(exact).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '拓展模式' }));
    expect(screen.getByRole('button', { name: '拓展模式' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('TC-71 · Home wiring — 從追蹤清單繼續 loads seeds + adopts geo/language', () => {
  const CREATED = '2026-07-01T00:00:00.000Z';

  it('繼續 a list → its members become seeds (C7) and its geo/language become the settings', async () => {
    server.use(
      http.get('/api/v1/tracking-lists', () =>
        HttpResponse.json([
          {
            listId: 'a',
            name: '競品觀察清單',
            geo: 'US',
            language: 'en',
            createdAt: CREATED,
            memberCount: 2,
          },
        ]),
      ),
      http.get('/api/v1/tracking-lists/a', () =>
        HttpResponse.json({
          listId: 'a',
          name: '競品觀察清單',
          geo: 'US',
          language: 'en',
          createdAt: CREATED,
          members: [
            {
              normalizedText: 'dyson 吸塵器',
              text: 'dyson 吸塵器',
              addedAt: CREATED,
              lastCheckedAt: null,
            },
            {
              normalizedText: '小米吸塵器',
              text: '小米吸塵器',
              addedAt: CREATED,
              lastCheckedAt: null,
            },
          ],
        }),
      ),
    );
    renderHome();

    const seeds = await screen.findByLabelText<HTMLTextAreaElement>('輸入搜尋詞');
    fireEvent.click(await screen.findByRole('button', { name: '從「競品觀察清單」繼續' }));

    await waitFor(() => expect(seeds.value).toBe('dyson 吸塵器\n小米吸塵器'));

    // The list-fixed geo/language are adopted into the persisted settings (T7.10).
    expect(useAnalysisSettingsStore.getState().geo).toBe('US');
    expect(useAnalysisSettingsStore.getState().language).toBe('en');
    expect(screen.getByRole('button', { name: '開始分析' })).toBeEnabled();
  });

  it('查看更多 navigates to the tracking-list page (/tracking)', async () => {
    server.use(
      http.get('/api/v1/tracking-lists', () =>
        HttpResponse.json(
          Array.from({ length: 4 }, (_, i) => ({
            listId: `l${i}`,
            name: `清單${i}`,
            geo: 'TW',
            language: 'zh-TW',
            createdAt: CREATED,
            memberCount: 3,
          })),
        ),
      ),
    );
    const router = renderHome();

    fireEvent.click(await screen.findByRole('button', { name: /查看更多/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tracking'));
  });
});

describe('TC-31/TC-74 · AI ideation (「」 slot) appends into seeds (no auto-create)', () => {
  it('the 送出 result C7-appends into the 輸入搜尋詞 textarea, without creating an analysis', async () => {
    server.use(
      http.post('/api/v1/ai-ideation', () =>
        HttpResponse.json({ keywords: ['塵蟎機', '手持吸塵器', '塵蟎機'] }, { status: 200 }),
      ),
    );
    const router = renderHome();

    const seeds = await screen.findByLabelText<HTMLTextAreaElement>('輸入搜尋詞');
    fireEvent.change(seeds, { target: { value: '手持吸塵器' } }); // an existing seed

    // Pick a template, fill the 「」 slot, 送出.
    fireEvent.click(screen.getByLabelText('發想模板'));
    fireEvent.click(screen.getByRole('button', { name: '發想「」的專業術語與技術規格' }));
    fireEvent.change(screen.getByLabelText('發想模板'), {
      target: { value: '發想「吸塵器」的專業術語與技術規格' },
    });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    // '手持吸塵器' already exists + '塵蟎機' duplicated among generated → one net append (C7).
    await waitFor(() => expect(seeds.value).toBe('手持吸塵器\n塵蟎機'));

    expect(router.state.location.search).not.toHaveProperty('analysisId');
    expect(screen.getByRole('button', { name: '開始分析' })).toBeInTheDocument();
  });
});
