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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../api/msw/server';
import { deserialize } from '../../lib/urlState';
import { useSelectionStore } from '../../stores/selectionStore';
import { KeywordsView } from './KeywordsView';

/**
 * TC-15 wiring (FR-4 / FR-1) — the keywords grand-table container. Fetches
 * `GET :id/keywords` (typed egress) and renders the presentational table + the
 * router-bound filters / pagination, mirroring the URL search state into the
 * request (filters carried into the query key + params, Design §5). Async states
 * (loading / empty / error) go through the shared StateViews. Router + Query
 * providers; egress MSW-mocked.
 */

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const KEYWORDS_ROUTE = '/api/v1/keyword-analyses/:id/keywords';

function row(text: string) {
  return {
    text,
    intentLabels: [],
    avgMonthlySearches: 1000,
    competition: 'HIGH',
    competitionIndex: 80,
    cpcLow: 0.5,
    cpcHigh: 1.5,
    monthlyVolumes: [],
  };
}

function renderKeywords(search = '') {
  const rootRoute = createRootRoute({ validateSearch: deserialize, component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <KeywordsView analysisId={ANALYSIS_ID} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: [`/${search}`] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('KeywordsView · keywords table data wiring', () => {
  it('fetches and renders the keyword rows + pagination footer', async () => {
    server.use(
      http.get(KEYWORDS_ROUTE, () =>
        HttpResponse.json({
          data: [row('running shoes'), row('trail shoes')],
          meta: { total: 2, page: 1, pageSize: 25, cursor: null },
        }),
      ),
    );
    renderKeywords();
    expect(await screen.findByRole('table', { name: '搜尋詞總表' })).toBeInTheDocument();
    expect(await screen.findByText('running shoes')).toBeInTheDocument();
    expect(await screen.findByText('trail shoes')).toBeInTheDocument();
    // pagination footer (T2.6) mounts alongside the table
    expect(screen.getByRole('group', { name: '分頁與排序' })).toBeInTheDocument();
  });

  it('carries the applied filter into the /keywords request query (Design §5)', async () => {
    const seenQ: (string | null)[] = [];
    server.use(
      http.get(KEYWORDS_ROUTE, ({ request }) => {
        seenQ.push(new URL(request.url).searchParams.get('q'));
        return HttpResponse.json({
          data: [row('running shoes')],
          meta: { total: 1, page: 1, pageSize: 25, cursor: null },
        });
      }),
    );
    renderKeywords();
    expect(await screen.findByText('running shoes')).toBeInTheDocument();

    // Apply a 搜尋詞 filter through the real FilterBar so the router writes the URL
    // `filters` param (proven KeywordsFilters path) → KeywordsView re-fetches with it.
    fireEvent.click(await screen.findByRole('button', { name: /搜尋詞/ }));
    const pop = within(screen.getByRole('group', { name: '搜尋詞 篩選' }));
    fireEvent.change(pop.getByLabelText('包含'), { target: { value: 'run' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    await waitFor(() => expect(seenQ).toContain('run'));
  });

  it('shows an empty state when the snapshot has no matching keywords', async () => {
    server.use(
      http.get(KEYWORDS_ROUTE, () =>
        HttpResponse.json({ data: [], meta: { total: 0, page: 1, pageSize: 25, cursor: null } }),
      ),
    );
    renderKeywords();
    expect(await screen.findByText(/沒有符合|沒有搜尋詞|尚無/)).toBeInTheDocument();
  });

  it('shows an error + retry when the keywords request fails, and recovers on retry', async () => {
    let calls = 0;
    server.use(
      http.get(KEYWORDS_ROUTE, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({
              data: [row('running shoes')],
              meta: { total: 1, page: 1, pageSize: 25, cursor: null },
            });
      }),
    );
    renderKeywords();
    fireEvent.click(await screen.findByRole('button', { name: '重試' }));
    expect(await screen.findByText('running shoes')).toBeInTheDocument();
  });
});

describe('KeywordsView · TSV copy (FR-13) + per-row selection (FR-19) mount', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    useSelectionStore.setState({ items: [] });
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => {
    useSelectionStore.setState({ items: [] });
    vi.restoreAllMocks();
  });

  function stubRows() {
    server.use(
      http.get(KEYWORDS_ROUTE, () =>
        HttpResponse.json({
          data: [row('running shoes'), row('trail shoes')],
          meta: { total: 2, page: 1, pageSize: 25, cursor: null },
        }),
      ),
    );
  }

  it('copies the visible rows as TSV via 複製表格', async () => {
    stubRows();
    renderKeywords();
    fireEvent.click(await screen.findByRole('button', { name: '複製表格' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const tsv = writeText.mock.calls[0][0];
    expect(tsv).toContain('搜尋詞');
    expect(tsv).toContain('running shoes');
  });

  it('does NOT mount selection checkboxes without a (geo, language) URL context', async () => {
    stubRows();
    renderKeywords();
    expect(await screen.findByText('running shoes')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('checking a row with a URL context populates the selection store + shows the bulk bar', async () => {
    stubRows();
    renderKeywords('?geo=TW&language=zh-TW');
    fireEvent.click(await screen.findByRole('checkbox', { name: '選取 running shoes' }));

    // The floating bulk bar appears off the store (deduped 搜尋詞 count).
    expect(await screen.findByRole('region', { name: '批次選取' })).toBeInTheDocument();
    expect(screen.getByText(/已選 1 項/)).toBeInTheDocument();
    // The picked keyword carries its list-layer-fixed (geo, language) context.
    expect(useSelectionStore.getState().items).toEqual([
      {
        kind: 'keyword',
        text: 'running shoes',
        geo: 'TW',
        language: 'zh-TW',
        analysisId: ANALYSIS_ID,
      },
    ]);
  });
});
