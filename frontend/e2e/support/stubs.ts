import type { Page, Route } from '@playwright/test';

/**
 * Shared Playwright route-stub helpers for the T6.4 e2e full-flow specs (TC-43~48).
 *
 * The `e2e` project runs against the **production preview build** (no live backend),
 * so every backend call is intercepted with `page.route` — the same discipline as the
 * pre-existing smoke / history / tracking specs, just factored into one reusable module
 * (the "e2e fixtures 復用 / 共用 stub helper" refactor called for by T6.4 ③). Vitest's
 * MSW handlers cannot run inside the browser preview, so this mirrors their response
 * **shapes** (validated client-side by the zod egress boundaries) rather than importing
 * them. Per-spec overrides just register a more specific `page.route` before these.
 */

const V1 = '/api/v1';

/** A minimal `GET /views` registry (mirrors `src/api/msw/handlers.ts`) — enough to drive
 * the dimension menu (搜尋詞總表 / 意圖主題) for the dashboard flows. */
export const DEFAULT_VIEWS = [
  {
    name: 'keywords',
    grain: 'keyword',
    allowedSelect: [],
    allowedFilters: ['q', 'volumeMin', 'volumeMax', 'competition', 'intent', 'intentMode'],
    allowedSort: ['avgMonthlySearches', 'competitionIndex', 'cpcLow', 'cpcHigh', 'text'],
    responseShape: 'table',
    requiresFeature: 'keyword_metrics',
  },
  {
    name: 'intent_topics',
    grain: 'topic',
    allowedSelect: [],
    allowedFilters: [],
    allowedSort: [],
    responseShape: 'table',
    requiresFeature: 'topics',
  },
] as const;

/**
 * One `keywords`-VIEW row (backend `pick(SnapshotRowData, select)`): raw `intent` (array), NOT the
 * lean list DTO's renamed `intentLabels`, plus `normalizedText` + `monthlyVolumes` — the shape the
 * 搜尋詞總表 now reads via the view-router (M7-R1). The egress maps `intent`→`intentLabels`, so the
 * rendered table (and its visual goldens) are unchanged. Nulls kept verbatim, never 0.
 */
export function keywordViewRow(text: string, overrides: Record<string, unknown> = {}) {
  return {
    text,
    normalizedText: text.trim().toLowerCase(),
    intent: ['commercial'],
    avgMonthlySearches: 12000,
    competition: 'HIGH',
    competitionIndex: 80,
    cpcLow: 1.2,
    cpcHigh: 3.4,
    monthlyVolumes: [
      { year: 2026, month: 1, searches: 1000 },
      { year: 2026, month: 2, searches: 1400 },
    ],
    ...overrides,
  };
}

/** Stub `GET /views` so the shell's dimension menu loads without a noisy fallback. */
export async function stubViews(
  page: Page,
  views: readonly unknown[] = DEFAULT_VIEWS,
): Promise<void> {
  await page.route(/\/api\/v1\/views(\?|$)/, (route) => route.fulfill({ json: { views } }));
}

/**
 * `POST :id/query` — the view-router. The 搜尋詞總表 results page embeds the 趨勢 card
 * (TrendView, T7.4) which reads `{view:'trend'}` on mount; stub it to an empty-but-valid
 * shape (mirrors the msw default) so the preview render is deterministic — no failed
 * request behind the table. Per-spec overrides can register a more specific route first.
 */
export async function stubQuery(page: Page): Promise<void> {
  await page.route(new RegExp(`${V1}/keyword-analyses/[^/]+/query(\\?|$)`), (route: Route) => {
    const view = (route.request().postDataJSON() as { view?: string } | null)?.view;
    if (view === 'trend') {
      return route.fulfill({ json: { view: 'trend', axis: [], total: [], series: [] } });
    }
    return route.fulfill({
      json: {
        view: view ?? 'keywords',
        columns: [],
        rows: [],
        pagination: { total: 0, page: 1, pageSize: 25, cursor: null },
      },
    });
  });
}

/** The parsed `POST :id/query` request body — only the fields the keyword stubs branch on. */
interface KeywordsQueryBody {
  view?: string;
  select?: string[];
  filters?: { intent?: string[]; q?: string } & Record<string, unknown>;
  pagination?: { page?: number; pageSize?: number; cursor?: string | null };
  sort?: { field: string; direction: string }[];
}

type KeywordsMeta = Partial<{
  total: number;
  page: number;
  pageSize: number;
  cursor: string | null;
}>;

/**
 * `POST :id/query` view-router stub carrying keyword rows (M7-R1: the 搜尋詞總表 reads via the
 * view-router, so rows carry monthlyVolumes + normalizedText). The co-mounted 趨勢 card's
 * `view:'trend'` request always gets an empty-but-valid axis; a keywords request is answered by
 * `resolve` — pass a static row array for the common single-page case, or a `(body) => { rows, meta }`
 * fn to branch on the applied filter / pagination (now carried in the POST body, not the URL query).
 * Register per-spec before the generic {@link stubQuery} so this more specific handler wins.
 */
export async function stubKeywordsQuery(
  page: Page,
  resolve:
    | ReturnType<typeof keywordViewRow>[]
    | ((body: KeywordsQueryBody) => {
        rows: ReturnType<typeof keywordViewRow>[];
        meta?: KeywordsMeta;
      }),
): Promise<void> {
  await page.route(new RegExp(`${V1}/keyword-analyses/[^/]+/query(\\?|$)`), (route: Route) => {
    const body = (route.request().postDataJSON() ?? {}) as KeywordsQueryBody;
    if (body.view === 'trend') {
      return route.fulfill({ json: { view: 'trend', axis: [], total: [], series: [] } });
    }
    const { rows, meta = {} } = typeof resolve === 'function' ? resolve(body) : { rows: resolve };
    return route.fulfill({
      json: {
        view: body.view ?? 'keywords',
        columns: [],
        rows,
        pagination: { total: rows.length, page: 1, pageSize: 25, cursor: null, ...meta },
      },
    });
  });
}

/**
 * Abort every analysis SSE stream (`:id/stream`, `:id/topics/stream`). `useJobTracking`
 * reacts to the connection error by falling back to its `GET :id` poll — a deterministic,
 * fast transport for the preview (a real event-stream is impractical to hand-fulfill).
 */
export async function stubStreamsOffline(page: Page): Promise<void> {
  await page.route(/\/api\/v1\/keyword-analyses\/[^/]+\/(topics\/)?stream(\?|$)/, (route) =>
    route.abort(),
  );
}

/** Stub `POST /keyword-analyses` (create) → 202 `{ analysisId }`. */
export async function stubCreateAnalysis(page: Page, analysisId: string): Promise<void> {
  await page.route(new RegExp(`${V1}/keyword-analyses(\\?|$)`), (route: Route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 202, json: { analysisId } });
    }
    return route.fallback();
  });
}

/**
 * Stub the authoritative `GET :id` snapshot. `status` may be a static object or a
 * function of the (0-based) call index so a run can flip running → completed over polls.
 */
export async function stubAnalysisStatus(
  page: Page,
  id: string,
  status:
    Record<string, unknown> | ((callIndex: number, elapsedMs: number) => Record<string, unknown>),
): Promise<void> {
  let calls = 0;
  const startedAt = Date.now();
  await page.route(new RegExp(`${V1}/keyword-analyses/${id}(\\?|$)`), (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const body = typeof status === 'function' ? status(calls, Date.now() - startedAt) : status;
    calls += 1;
    return route.fulfill({ json: body });
  });
}
