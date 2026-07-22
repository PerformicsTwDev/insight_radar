import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { deserialize } from '../../lib/urlState';
import { axe } from '../../test/axe';
import { AiSearchHome } from './AiSearchHome';

/**
 * TC-61 (品牌檔案卡 + AI 補全 HITL) + TC-63 (探索模式 pills + 抓取渠道 + 驗證 → 建立).
 * Mirrors the HomeRoute harness: a memory-history router (root owns the same
 * `deserialize` search codec) so `router.state.location.search` reflects real
 * navigation after the 202. All egress is MSW-mocked (no real backend).
 */

const PROFILE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const JOB_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

function renderHome(entry = '/ai-search') {
  const rootRoute = createRootRoute({ validateSearch: deserialize, component: Outlet });
  const aiRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/ai-search',
    component: AiSearchHome,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([aiRoute]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** Fill the always-required brand fields (品牌名 + ≥1 alias + ≥1 site). */
async function fillBrand() {
  fireEvent.change(await screen.findByLabelText('品牌名'), { target: { value: 'Dyson' } });
  const alias = screen.getByLabelText('新增品牌別名');
  fireEvent.change(alias, { target: { value: '戴森' } });
  fireEvent.keyDown(alias, { key: 'Enter' });
  const site = screen.getByLabelText('新增品牌網站');
  fireEvent.change(site, { target: { value: 'https://www.dyson.tw' } });
  fireEvent.keyDown(site, { key: 'Enter' });
}

describe('TC-61 · 品牌檔案卡 (品牌名 / 別名 chips / 網站 chips / 競品 / ✦ AI 補全 HITL)', () => {
  it('gates the CTA on the required brand fields + a channel, listing what is missing', async () => {
    renderHome();
    const cta = await screen.findByRole('button', { name: '開始分析' });
    expect(cta).toBeDisabled();
    expect(
      screen.getByText(/請完成：.*品牌名.*品牌別名.*品牌網站.*至少一個抓取渠道/),
    ).toBeInTheDocument();

    await fillBrand();
    // still missing a channel
    expect(cta).toBeDisabled();
    expect(screen.getByText('請完成：至少一個抓取渠道')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }));
    expect(cta).toBeEnabled();
  });

  it('adds and removes 品牌別名 chips via Enter / ✕', async () => {
    renderHome();
    const alias = await screen.findByLabelText('新增品牌別名');
    fireEvent.change(alias, { target: { value: '戴森' } });
    fireEvent.keyDown(alias, { key: 'Enter' });
    expect(screen.getByText('戴森')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '移除 戴森' }));
    expect(screen.queryByText('戴森')).not.toBeInTheDocument();
  });

  it('appends a competitor row on 新增競品 (no separate add button)', async () => {
    renderHome();
    expect(screen.queryByLabelText('競品 1 名稱')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /新增競品/ }));
    expect(screen.getByLabelText('競品 1 名稱')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /新增競品/ }));
    expect(screen.getByLabelText('競品 2 名稱')).toBeInTheDocument();
  });

  it('disables ✦ AI 補全 until a brand name is entered', async () => {
    renderHome();
    const assist = await screen.findByRole('button', { name: /AI 補全/ });
    expect(assist).toBeDisabled();
    fireEvent.change(screen.getByLabelText('品牌名'), { target: { value: 'Dyson' } });
    expect(assist).toBeEnabled();
  });

  it('offers AI candidate aliases as HITL chips — added only on click, de-duped, never auto-written', async () => {
    server.use(
      http.post('/api/v1/ai-ideation', () =>
        HttpResponse.json({ keywords: ['戴森', 'Dyson Taiwan'] }, { status: 200 }),
      ),
    );
    renderHome();
    fireEvent.change(await screen.findByLabelText('品牌名'), { target: { value: 'Dyson' } });

    // A pre-existing manual alias — proves the AI suggestion de-dupes against it (C7).
    const alias = screen.getByLabelText('新增品牌別名');
    fireEvent.change(alias, { target: { value: '戴森' } });
    fireEvent.keyDown(alias, { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: /AI 補全/ }));

    // Candidates appear as suggestion chips — NOT written into the alias list yet.
    // (Alias chips are counted by their "移除 X" remove buttons, which suggestions lack.)
    const suggestDyson = await screen.findByRole('button', { name: '加入品牌別名 Dyson Taiwan' });
    expect(screen.getByRole('button', { name: '加入品牌別名 戴森' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '移除 戴森' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '移除 Dyson Taiwan' })).not.toBeInTheDocument();

    fireEvent.click(suggestDyson);
    expect(screen.getByRole('button', { name: '移除 Dyson Taiwan' })).toBeInTheDocument();

    // Clicking the "戴森" suggestion is a no-op (de-dupes against the existing chip).
    fireEvent.click(screen.getByRole('button', { name: '加入品牌別名 戴森' }));
    expect(screen.getAllByRole('button', { name: '移除 戴森' })).toHaveLength(1);
  });

  it('has no axe violations on first render', async () => {
    renderHome();
    await screen.findByRole('button', { name: '開始分析' });
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('TC-63 · 探索模式 pills + 抓取渠道 複選 + 驗證 → 建立', () => {
  it('hides the 搜尋詞 manager in 品牌整體模式 and shows it in 指定模式', async () => {
    renderHome();
    await screen.findByRole('button', { name: '開始分析' });
    // default = 品牌整體模式 → no seed manager
    expect(screen.queryByLabelText('搜尋詞')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '指定模式' }));
    expect(screen.getByLabelText('搜尋詞')).toBeInTheDocument();
    // the FR-20 AI 發想 sub-card rides along in 指定模式
    expect(screen.getByRole('button', { name: '送出' })).toBeInTheDocument();
  });

  it('appends FR-20 AI-ideation results into the 搜尋詞 field (de-duped) in 指定模式', async () => {
    server.use(
      http.post('/api/v1/ai-ideation', () =>
        HttpResponse.json({ keywords: ['吸塵器推薦', 'dyson 吸塵器'] }, { status: 200 }),
      ),
    );
    renderHome();
    fireEvent.click(await screen.findByRole('tab', { name: '指定模式' }));
    const seeds = screen.getByLabelText<HTMLTextAreaElement>('搜尋詞');
    fireEvent.change(seeds, { target: { value: 'dyson 吸塵器' } });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    // "dyson 吸塵器" de-dupes against the existing seed (C7); only the new one appends.
    await waitFor(() => expect(seeds.value).toBe('dyson 吸塵器\n吸塵器推薦'));
  });

  it('requires 搜尋詞 in 指定模式 (added to the missing-fields hint)', async () => {
    renderHome();
    await fillBrand();
    fireEvent.click(await screen.findByRole('button', { name: 'ChatGPT' }));
    // brand mode → submittable
    expect(screen.getByRole('button', { name: '開始分析' })).toBeEnabled();

    fireEvent.click(screen.getByRole('tab', { name: '指定模式' }));
    expect(screen.getByRole('button', { name: '開始分析' })).toBeDisabled();
    expect(screen.getByText('請完成：搜尋詞')).toBeInTheDocument();
  });

  it('toggles 抓取渠道 as a multi-select (aria-pressed)', async () => {
    renderHome();
    const chatgpt = await screen.findByRole('button', { name: 'ChatGPT' });
    expect(chatgpt).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chatgpt);
    expect(chatgpt).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chatgpt);
    expect(chatgpt).toHaveAttribute('aria-pressed', 'false');
  });

  it('建立: brand mode → POST /brand-profiles then POST /ai-search-analyses w/ brandProfileId → navigate', async () => {
    let brandBody: unknown;
    let analysisBody: unknown;
    server.use(
      http.post('/api/v1/brand-profiles', async ({ request }) => {
        brandBody = await request.json();
        return HttpResponse.json(
          {
            id: PROFILE_ID,
            brand: { name: 'Dyson', aliases: ['戴森'], sites: ['https://www.dyson.tw'] },
            competitors: [],
            createdAt: '2026-07-23T00:00:00.000Z',
          },
          { status: 201 },
        );
      }),
      http.post('/api/v1/ai-search-analyses', async ({ request }) => {
        analysisBody = await request.json();
        return HttpResponse.json({ jobId: JOB_ID }, { status: 202 });
      }),
    );
    const router = renderHome();

    await fillBrand();
    fireEvent.click(await screen.findByRole('button', { name: 'AI Overview' }));
    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }));
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ jobId: JOB_ID }));

    expect(brandBody).toEqual({
      brand: { name: 'Dyson', aliases: ['戴森'], sites: ['https://www.dyson.tw'] },
      competitors: [],
    });
    // brand-mode keywords are derived from the brand universe; channels are the mapped enums.
    expect(analysisBody).toEqual({
      keywords: ['Dyson', '戴森'],
      channels: ['googleSearch', 'chatGpt'],
      brandProfileId: PROFILE_ID,
    });
  });

  it('surfaces a 409 duplicate brand name inline without creating an analysis', async () => {
    let analysisCalled = false;
    server.use(
      http.post('/api/v1/brand-profiles', () =>
        HttpResponse.json({ statusCode: 409, code: 'CONFLICT' }, { status: 409 }),
      ),
      http.post('/api/v1/ai-search-analyses', () => {
        analysisCalled = true;
        return HttpResponse.json({ jobId: JOB_ID }, { status: 202 });
      }),
    );
    const router = renderHome();

    await fillBrand();
    fireEvent.click(await screen.findByRole('button', { name: 'ChatGPT' }));
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

    expect(await screen.findByText(/品牌名.*已存在|已存在/)).toBeInTheDocument();
    expect(analysisCalled).toBe(false);
    expect(router.state.location.search).not.toHaveProperty('jobId');
  });

  it('sends specified-mode seeds as the analysis keywords', async () => {
    let analysisBody: unknown;
    server.use(
      http.post('/api/v1/brand-profiles', () =>
        HttpResponse.json(
          {
            id: PROFILE_ID,
            brand: { name: 'Dyson', aliases: ['戴森'], sites: ['https://www.dyson.tw'] },
            competitors: [],
            createdAt: '2026-07-23T00:00:00.000Z',
          },
          { status: 201 },
        ),
      ),
      http.post('/api/v1/ai-search-analyses', async ({ request }) => {
        analysisBody = await request.json();
        return HttpResponse.json({ jobId: JOB_ID }, { status: 202 });
      }),
    );
    renderHome();

    await fillBrand();
    fireEvent.click(await screen.findByRole('tab', { name: '指定模式' }));
    fireEvent.change(screen.getByLabelText('搜尋詞'), {
      target: { value: 'dyson 吸塵器\n吸塵器推薦' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }));
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

    await waitFor(() =>
      expect(analysisBody).toMatchObject({ keywords: ['dyson 吸塵器', '吸塵器推薦'] }),
    );
  });

  it('surfaces a generic error when the brand create fails (non-409)', async () => {
    server.use(http.post('/api/v1/brand-profiles', () => HttpResponse.json({}, { status: 500 })));
    renderHome();
    await fillBrand();
    fireEvent.click(await screen.findByRole('button', { name: 'ChatGPT' }));
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));
    expect(await screen.findByText('建立品牌檔案失敗，請稍後再試。')).toBeInTheDocument();
  });

  it('surfaces a generic error when the analysis enqueue fails', async () => {
    server.use(
      http.post('/api/v1/brand-profiles', () =>
        HttpResponse.json(
          {
            id: PROFILE_ID,
            brand: { name: 'Dyson', aliases: ['戴森'], sites: ['https://www.dyson.tw'] },
            competitors: [],
            createdAt: '2026-07-23T00:00:00.000Z',
          },
          { status: 201 },
        ),
      ),
      http.post('/api/v1/ai-search-analyses', () => HttpResponse.json({}, { status: 500 })),
    );
    renderHome();
    await fillBrand();
    fireEvent.click(await screen.findByRole('button', { name: 'ChatGPT' }));
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));
    expect(await screen.findByText('建立分析失敗，請稍後再試。')).toBeInTheDocument();
  });

  it('restores the AI-job placeholder from a jobId in the URL (URL-is-state) and can reset', async () => {
    const router = renderHome(`/ai-search?jobId=${JOB_ID}`);
    expect(
      await screen.findByRole('heading', { name: 'AI Search 分析建立中' }),
    ).toBeInTheDocument();
    expect(screen.getByText(JOB_ID)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '建立另一個分析' }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('jobId'));
    expect(await screen.findByRole('button', { name: '開始分析' })).toBeInTheDocument();
  });
});

/** Guards against the competitor row markup regressing to shared-name inputs. */
describe('competitor row wiring', () => {
  it('keeps competitor name inputs independently addressable', async () => {
    renderHome();
    fireEvent.click(await screen.findByRole('button', { name: /新增競品/ }));
    const row = screen.getByLabelText('競品 1 名稱');
    fireEvent.change(row, { target: { value: 'Shark' } });
    expect(
      within(screen.getByRole('group', { name: '競品 1' })).getByDisplayValue('Shark'),
    ).toBeInTheDocument();
  });
});
