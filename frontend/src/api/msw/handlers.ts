import { http, HttpResponse } from 'msw';
import type { paths } from '../schema';

/** `/health` 200 response 型別——由 openapi `paths` 契約約束 mock 形狀（不手寫、隨 codegen 漂移即編譯紅）。 */
type HealthOk = paths['/health']['get']['responses']['200']['content']['application/json'];

/**
 * MSW handlers——response 形狀由 openapi `paths` **型別約束**（對齊後端契約；Design §2 mock 政策：
 * 元件/契約測試在此攔截、不打真後端）。M1+ 各 view 依需擴充；per-test 覆寫用 `server.use(...)`。
 */
export const handlers = [
  http.get('/health', () =>
    HttpResponse.json<HealthOk>({
      status: 'ok',
      info: { database: { status: 'up' }, cache: { status: 'up' } },
      error: {},
      details: { database: { status: 'up' }, cache: { status: 'up' } },
    }),
  ),
  // `GET /views` (T3.1, FR-1) — the shell reads it on mount to drive the dimension
  // menu. openapi types the 200 as `never` (#392), so the shape can't be bound to
  // `paths` here (unlike `/health`); it mirrors the backend view-registry metadata
  // contract (validated client-side by the zod boundary in `api/views.ts`). Per-test
  // overrides use `server.use(...)`.
  http.get('/api/v1/views', () =>
    HttpResponse.json({
      views: [
        {
          name: 'keywords',
          grain: 'keyword',
          allowedSelect: [
            { key: 'text', type: 'text' },
            { key: 'avgMonthlySearches', type: 'number' },
            { key: 'competition', type: 'text' },
            { key: 'competitionIndex', type: 'number' },
            { key: 'cpcLow', type: 'number' },
            { key: 'cpcHigh', type: 'number' },
            { key: 'intent', type: 'array' },
            { key: 'monthlyVolumes', type: 'array' },
          ],
          allowedFilters: [
            'q',
            'volumeMin',
            'volumeMax',
            'cpcMin',
            'cpcMax',
            'competition',
            'competitionIndexMin',
            'competitionIndexMax',
            'intent',
            'intentMode',
          ],
          allowedSort: ['avgMonthlySearches', 'competitionIndex', 'cpcLow', 'cpcHigh', 'text'],
          responseShape: 'table',
          requiresFeature: 'keyword_metrics',
        },
        {
          name: 'trend',
          grain: 'month',
          allowedSelect: [],
          allowedFilters: ['q', 'volumeMin', 'volumeMax', 'intent', 'intentMode'],
          allowedSort: [],
          responseShape: 'trend',
          requiresFeature: 'keyword_metrics',
        },
        {
          name: 'intent_distribution',
          grain: 'intentLabel',
          allowedSelect: [],
          allowedFilters: ['q', 'volumeMin', 'volumeMax', 'intent', 'intentMode'],
          allowedSort: [],
          responseShape: 'chart',
          requiresFeature: 'keyword_metrics',
        },
        {
          name: 'cpc_histogram',
          grain: 'bucket',
          allowedSelect: [],
          allowedFilters: ['q', 'volumeMin', 'volumeMax'],
          allowedSort: [],
          responseShape: 'chart',
          requiresFeature: 'keyword_metrics',
        },
        {
          name: 'serp_questions',
          grain: 'entity',
          allowedSelect: [],
          allowedFilters: [],
          allowedSort: [],
          responseShape: 'table',
          requiresFeature: 'serp',
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
        // journey / journey_funnel mirror the backend BUILTIN_VIEWS (T12.6) so the
        // dashboard nav + view-content routing (T6.0) surface them registry-driven.
        {
          name: 'journey',
          grain: 'keyword',
          allowedSelect: [],
          allowedFilters: [],
          allowedSort: [],
          responseShape: 'table',
          requiresFeature: 'journey',
        },
        {
          name: 'journey_funnel',
          grain: 'journeyStage',
          allowedSelect: [],
          allowedFilters: [],
          allowedSort: [],
          responseShape: 'chart',
          requiresFeature: 'journey',
        },
      ],
    }),
  ),
  // `GET /tracking-lists` (T5.7/T7.7, FR-19) — the home「從追蹤清單繼續」section reads
  // it on mount (via `useTrackingLists`). Default to an EMPTY list so an unstubbed
  // render keeps the section hidden (AC-2.3: no lists → section hidden, not drawn
  // empty) rather than tripping `onUnhandledRequest: 'error'`. Tests that need lists
  // override with `server.use(...)`. openapi types the body as `never` (#392), so the
  // shape mirrors the backend `TrackingListSummary[]` contract (zod-validated in
  // `api/trackingLists.ts`).
  http.get('/api/v1/tracking-lists', () => HttpResponse.json([])),
];
