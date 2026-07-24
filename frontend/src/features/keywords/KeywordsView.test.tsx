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
// M7-R1: the table now reads via POST /query {view:keywords} (carries monthlyVolumes), not GET /keywords.
const QUERY_ROUTE = '/api/v1/keyword-analyses/:id/query';

/** A keywords-VIEW row (raw `intent`, not the list DTO's `intentLabels`) — the backend `pick` shape. */
function row(text: string) {
  return {
    text,
    normalizedText: text,
    intent: [],
    avgMonthlySearches: 1000,
    competition: 'HIGH',
    competitionIndex: 80,
    cpcLow: 0.5,
    cpcHigh: 1.5,
    monthlyVolumes: [],
  };
}

/**
 * Install a view-aware `POST /query` handler (mirrors the default handler). The co-mounted 趨勢 card
 * fires its own `view:'trend'` request on mount; give it an empty-but-valid trend axis so it renders
 * its chart (region 搜尋趨勢) rather than an error card, while any keywords request returns a
 * table-view carrying `rows`. Tests asserting on filter/error behaviour install their own handler.
 */
function stubQuery(
  rows: ReturnType<typeof row>[],
  meta?: Partial<{ total: number; page: number; pageSize: number; cursor: string | null }>,
) {
  server.use(
    http.post(QUERY_ROUTE, async ({ request }) => {
      const { view } = (await request.json()) as { view: string };
      if (view === 'trend') {
        return HttpResponse.json({ view: 'trend', axis: [], total: [], series: [] });
      }
      return HttpResponse.json({
        view: 'keywords',
        columns: [],
        rows,
        pagination: { total: rows.length, page: 1, pageSize: 25, cursor: null, ...meta },
      });
    }),
  );
}

function renderKeywords(search = '', features?: unknown) {
  const rootRoute = createRootRoute({ validateSearch: deserialize, component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <KeywordsView analysisId={ANALYSIS_ID} features={features} />,
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
    stubQuery([row('running shoes'), row('trail shoes')]);
    renderKeywords();
    expect(await screen.findByRole('table', { name: '搜尋詞總表' })).toBeInTheDocument();
    expect(await screen.findByText('running shoes')).toBeInTheDocument();
    expect(await screen.findByText('trail shoes')).toBeInTheDocument();
    // pagination footer (T2.6) mounts alongside the table
    expect(screen.getByRole('group', { name: '分頁與排序' })).toBeInTheDocument();
  });

  it('carries the applied filter into the /query request body (Design §5)', async () => {
    const seenQ: (string | null)[] = [];
    server.use(
      http.post(QUERY_ROUTE, async ({ request }) => {
        const body = (await request.json()) as { view: string; filters?: { q?: string } };
        // The co-mounted 趨勢 card's trend request carries no filters — keep it healthy and
        // only capture the keywords request's applied 搜尋詞 filter.
        if (body.view === 'trend') {
          return HttpResponse.json({ view: 'trend', axis: [], total: [], series: [] });
        }
        seenQ.push(body.filters?.q ?? null);
        return HttpResponse.json({
          view: 'keywords',
          columns: [],
          rows: [row('running shoes')],
          pagination: { total: 1, page: 1, pageSize: 25, cursor: null },
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
    stubQuery([]);
    renderKeywords();
    // Specific to the keywords empty state — the co-mounted 趨勢 card (T7.4) has its own
    // "尚無趨勢資料" empty text, so a broad /尚無/ would now over-match.
    expect(await screen.findByText('沒有符合條件的搜尋詞。')).toBeInTheDocument();
  });

  it('shows an error + retry when the keywords request fails, and recovers on retry', async () => {
    let calls = 0;
    server.use(
      http.post(QUERY_ROUTE, async ({ request }) => {
        const body = (await request.json()) as { view: string; select?: string[] };
        // Keep the co-mounted 趨勢 card healthy: its trend request + its top-N series request
        // (select = [text, monthlyVolumes]) always succeed, so the error/retry is isolated to
        // the main 搜尋詞總表 query (which selects the full volume-bearing column set).
        if (body.view === 'trend') {
          return HttpResponse.json({ view: 'trend', axis: [], total: [], series: [] });
        }
        if ((body.select?.length ?? 0) <= 2) {
          return HttpResponse.json({
            view: 'keywords',
            columns: [],
            rows: [],
            pagination: { total: 0, page: 1, pageSize: 25, cursor: null },
          });
        }
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({
              view: 'keywords',
              columns: [],
              rows: [row('running shoes')],
              pagination: { total: 1, page: 1, pageSize: 25, cursor: null },
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
    stubQuery([row('running shoes'), row('trail shoes')]);
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

describe('TC-59 · results dashboard v4 structure (T7.4)', () => {
  it('lays out filter bar + 趨勢 card + table + collapsible AI 洞察 panel', async () => {
    stubQuery([row('running shoes')]);
    renderKeywords();

    // Core results grid (with its ✦ AI column + sparklines).
    expect(await screen.findByRole('table', { name: '搜尋詞總表' })).toBeInTheDocument();
    // Filter bar (FR-6).
    expect(screen.getByRole('group', { name: '篩選' })).toBeInTheDocument();
    // 趨勢 card at the top of the results page (T7.3/T7.4).
    expect(screen.getByRole('region', { name: '搜尋趨勢' })).toBeInTheDocument();
    // Right-side AI 洞察 panel — present, EXPANDED by default (M7-R6, v4), with a header 隱藏 toggle.
    expect(screen.getByRole('complementary', { name: 'AI 洞察側欄' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /隱藏 AI 洞察/ })).toBeInTheDocument();
  });

  it('the header 隱藏/顯示 AI 洞察 toggle collapses and re-expands the panel (M7-R6)', async () => {
    stubQuery([row('running shoes')]);
    renderKeywords();
    await screen.findByRole('table', { name: '搜尋詞總表' });

    const hide = screen.getByRole('button', { name: /隱藏 AI 洞察/ });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(hide);
    expect(screen.getByRole('button', { name: /顯示 AI 洞察/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('fills the fixed-height results column: the table flex-fills + scrolls (no fixed cap), M7-R4', async () => {
    stubQuery([row('running shoes')]);
    renderKeywords();
    const table = await screen.findByRole('table', { name: '搜尋詞總表' });
    // The 搜尋詞總表 fills the remaining height of the results row (flex-1 + min-h-0) and scrolls
    // internally — the virtualizer's scroll element — instead of the old fixed 600px cap (M7-R4),
    // so the centre table scrolls independently of the trend card + the right AI 側欄.
    expect(table.className).toContain('flex-1');
    expect(table.className).toContain('min-h-0');
    expect(table.className).not.toContain('max-h-[600px]');
  });
});

describe('TC-28 · KeywordsView 搜尋意圖主題 on-demand column (M7-R2b, FR-18)', () => {
  const TOPICS_ROUTE = '/api/v1/keyword-analyses/:id/topics';

  /** A `GET :id/topics` body carrying the given classified keywords (rest of the shape is inert). */
  const topicsBody = (
    keywords: {
      text: string;
      normalizedText: string;
      topicName: string | null;
      isNoise?: boolean;
    }[],
  ) => ({
    status: 'completed',
    progress: null,
    clusters: [],
    keywords: keywords.map((k) => ({
      parentTopic: null,
      intentLabel: null,
      confidence: 1,
      isNoise: false,
      ...k,
    })),
    meta: { runId: 'r', snapshotId: 's', clusterCount: 1, noiseCount: 0 },
  });

  it('shows the client-joined topic pill for a ready analysis (join by normalizedText, D2)', async () => {
    stubQuery([row('running shoes'), row('trail shoes')]);
    server.use(
      http.get(TOPICS_ROUTE, () =>
        HttpResponse.json(
          topicsBody([
            { text: 'running shoes', normalizedText: 'running shoes', topicName: '規格探究' },
          ]),
        ),
      ),
    );
    renderKeywords('', { topics: { status: 'ready' } });

    // The classified keyword renders its topic pill; the header is a plain label (ready phase).
    expect(await screen.findByText('規格探究')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '搜尋意圖主題' })).toBeInTheDocument();
  });

  it('masks the column behind a ✦ generate-all trigger when topics are not generated (C13 decoupled)', async () => {
    stubQuery([row('running shoes')]);
    // No GET :id/topics is stubbed — a not_generated gate must NOT fetch topics (query disabled).
    renderKeywords('', { topics: { status: 'not_generated' } });
    await screen.findByRole('table', { name: '搜尋詞總表' });

    // Header offers the 「generate all」 ✦ trigger (generatable); the cells stay masked.
    expect(screen.getByRole('button', { name: /搜尋意圖主題/ })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: '尚未生成' }).length).toBeGreaterThan(0);
  });

  it('runs the topics job (POST :id/topics) when the ✦ generate-all trigger is clicked (M7-R2b)', async () => {
    stubQuery([row('running shoes')]);
    let started = false;
    server.use(
      http.post('/api/v1/keyword-analyses/:id/topics', () => {
        started = true;
        return HttpResponse.json({ topicJobId: 'tj-1' }, { status: 202 });
      }),
    );
    renderKeywords('', { topics: { status: 'not_generated' } });

    // Clicking the column-header ✦ starts the topics run via useTopics.start (the wiring the
    // coverage ratchet flagged) — it does NOT unlock the left 意圖主題 view (C13, verified in review).
    fireEvent.click(await screen.findByRole('button', { name: /搜尋意圖主題/ }));
    await waitFor(() => expect(started).toBe(true));
  });
});

describe('TC-28 · KeywordsView 購買歷程主題 on-demand column (M7-R2c, FR-15/FR-18)', () => {
  it('shows the client-joined journey stage pill for a ready analysis (join by normalizedText, D2)', async () => {
    server.use(
      http.post(QUERY_ROUTE, async ({ request }) => {
        const { view } = (await request.json()) as { view: string };
        if (view === 'trend') {
          return HttpResponse.json({ view: 'trend', axis: [], total: [], series: [] });
        }
        if (view === 'journey') {
          // The journey view carries `stage` + `normalizedText` (default select) per keyword.
          return HttpResponse.json({
            view: 'journey',
            columns: [],
            rows: [
              { text: 'running shoes', normalizedText: 'running shoes', stage: 'spec_comparison' },
            ],
            pagination: { total: 1, page: 1, pageSize: 25, cursor: null },
          });
        }
        return HttpResponse.json({
          view: 'keywords',
          columns: [],
          rows: [row('running shoes')],
          pagination: { total: 1, page: 1, pageSize: 25, cursor: null },
        });
      }),
      // useJourney also probes the run status (partial notice) once ready — completed here.
      http.get('/api/v1/keyword-analyses/:id/journey', () =>
        HttpResponse.json({
          journeyJobId: 'j-1',
          status: 'completed',
          progress: null,
          keywordCount: 1,
        }),
      ),
    );
    renderKeywords('', { journey: { status: 'ready' } });

    // The stage enum is resolved to its zh label (規格比較) via the SSOT and shown as a blue pill.
    expect(await screen.findByText('規格比較')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '購買歷程主題' })).toBeInTheDocument();
  });

  it('fetches ALL journey stages (large pageSize, light select) for the column join, not the default first-50 page (M7-R12)', async () => {
    let stagesBody: { select?: string[]; pagination?: { pageSize?: number } } | undefined;
    server.use(
      http.post(QUERY_ROUTE, async ({ request }) => {
        const body = (await request.json()) as {
          view: string;
          select?: string[];
          pagination?: { pageSize?: number };
        };
        if (body.view === 'trend') {
          return HttpResponse.json({ view: 'trend', axis: [], total: [], series: [] });
        }
        if (body.view === 'journey') {
          // Capture the column's dedicated all-stages query (the one selecting normalizedText+stage).
          if (body.select?.length === 2) stagesBody = body;
          return HttpResponse.json({
            view: 'journey',
            columns: [],
            rows: [],
            pagination: {
              total: 0,
              page: 1,
              pageSize: body.pagination?.pageSize ?? 50,
              cursor: null,
            },
          });
        }
        return HttpResponse.json({
          view: 'keywords',
          columns: [],
          rows: [row('running shoes')],
          pagination: { total: 1, page: 1, pageSize: 25, cursor: null },
        });
      }),
      http.get('/api/v1/keyword-analyses/:id/journey', () =>
        HttpResponse.json({
          journeyJobId: 'j',
          status: 'completed',
          progress: null,
          keywordCount: 0,
        }),
      ),
    );
    renderKeywords('', { journey: { status: 'ready' } });
    await screen.findByRole('table', { name: '搜尋詞總表' });

    // The join must cover every keyword (a keyword surfaced on a later table page/sort must not show
    // — as if unclassified) → a large pageSize + a normalizedText/stage-only select (Map, no render).
    await waitFor(() => expect(stagesBody).toBeDefined());
    expect(stagesBody?.select).toEqual(['normalizedText', 'stage']);
    expect(stagesBody?.pagination?.pageSize ?? 50).toBeGreaterThan(1000);
  });

  it('runs the journey job (POST :id/journey) when the ✦ generate-all trigger is clicked (M7-R2c)', async () => {
    stubQuery([row('running shoes')]);
    let started = false;
    server.use(
      http.post('/api/v1/keyword-analyses/:id/journey', () => {
        started = true;
        return HttpResponse.json({ journeyJobId: 'jj-1' }, { status: 202 });
      }),
    );
    renderKeywords('', { journey: { status: 'not_generated' } });

    // Clicking the column-header ✦ starts the journey run via useJourney.start (the wiring the
    // coverage ratchet flagged) — gate-decoupled from the left 購買歷程 view (C13).
    fireEvent.click(await screen.findByRole('button', { name: /購買歷程主題/ }));
    await waitFor(() => expect(started).toBe(true));
  });
});
