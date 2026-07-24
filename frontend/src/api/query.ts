import { z } from 'zod';
import { api } from './client';
import type { FilterSpec } from '../lib/filterSpec';
import { ErrorResponseSchema, type ErrorResponse } from './keywordAnalyses';

/**
 * Typed egress for `POST /api/v1/keyword-analyses/:id/query` (T2.4, FR-5/FR-14).
 * Business code calls this — never a bare `fetch` (single-egress, Design §2/§3).
 *
 * **openapi gaps (deviation, documented):** the backend `openapi.json` types the
 * request `QueryDto` as `Record<string, never>` (empty) and declares **no**
 * response body schema (#392 class). So we (a) bind the **path** to the generated
 * op (path drift → compile error) and send the real body cast-free via a
 * request-level `bodySerializer` (openapi-fetch calls it whenever `body` is not
 * `undefined`; `body: {}` satisfies the `Record<string, never>` type), and (b)
 * zod-validate the untyped **response** body here against the view-router contract
 * (backend `view-definition.ts`): a structural union over the three response
 * shapes (table | trend | chart), each tagged with a `kind` discriminant. The
 * response `view` field carries the view **name** (`keywords`/`trend`/
 * `intent_distribution`/…), not the kind — several names share a shape — so the
 * union discriminates **structurally** on each shape's distinctive keys.
 */

/**
 * The `/query` body's `filters` — the canonical backend-exact `FilterSpec`. Single
 * source in `lib/filterSpec` (the chips↔spec↔URL codec, T2.5 / Design §6 C4);
 * re-exported under the historical name so existing imports keep working and the
 * `/query` + `/keywords` filters share one shape (no divergent copy).
 */
export type QueryFilters = FilterSpec;

export interface QuerySort {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
}

export interface QueryPagination {
  readonly page?: number;
  readonly pageSize?: number;
  readonly cursor?: string;
}

/** `POST /query` request body (backend `QueryDto`). For T2.4 the trend chart sends `{ view: 'trend' }`. */
export interface QueryRequest {
  readonly view: string;
  readonly select?: readonly string[];
  readonly filters?: QueryFilters;
  readonly sort?: readonly QuerySort[];
  readonly pagination?: QueryPagination;
}

/** `ColumnDef` (backend `view-definition.ts`). */
const ColumnDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'array']),
});

/** `PageMeta` (backend `paginate.ts`; `cursor` null on the last page). */
const PageMetaSchema = z.object({
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  cursor: z.string().nullable(),
});

/** table view: distinctive keys `columns` + `rows` + `pagination` (backend `TableViewResult`). */
const TableViewSchema = z
  .object({
    view: z.string(),
    columns: z.array(ColumnDefSchema),
    rows: z.array(z.record(z.string(), z.unknown())),
    pagination: PageMetaSchema,
  })
  .transform((v) => ({ kind: 'table' as const, ...v }));

/** trend view: distinctive keys `axis` + `total` + `series` (backend `TrendViewResult`). */
const TrendViewSchema = z
  .object({
    view: z.string(),
    axis: z.array(z.string()),
    total: z.array(z.number()),
    series: z.array(z.object({ keyword: z.string(), points: z.array(z.number().nullable()) })),
  })
  .transform((v) => ({ kind: 'trend' as const, ...v }));

/** chart view: distinctive keys `groups` + `meta` (backend `ChartViewResult`). */
const ChartViewSchema = z
  .object({
    view: z.string(),
    groups: z.array(
      z.object({
        key: z.record(z.string(), z.union([z.string(), z.number()])),
        measures: z.record(z.string(), z.number().nullable()),
      }),
    ),
    meta: z.object({ total: z.number(), truncated: z.boolean() }),
  })
  .transform((v) => ({ kind: 'chart' as const, ...v }));

/**
 * The three view-response shapes. `z.union` tries each in order and returns the
 * first match; each schema requires its distinctive keys, so a body of one shape
 * can never match another (order-independent). A body matching none → parse error.
 */
export const QueryViewSchema = z.union([TrendViewSchema, TableViewSchema, ChartViewSchema]);

export type TableView = Extract<z.infer<typeof QueryViewSchema>, { kind: 'table' }>;
export type TrendView = Extract<z.infer<typeof QueryViewSchema>, { kind: 'trend' }>;
export type ChartView = Extract<z.infer<typeof QueryViewSchema>, { kind: 'chart' }>;
export type QueryView = z.infer<typeof QueryViewSchema>;

export type PostQueryResult =
  | { readonly ok: true; readonly view: QueryView }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

/**
 * Run a view query. Egress via the typed `api` client (never a bare fetch). On 2xx
 * the (openapi-untyped) body is zod-validated as the view-shape union and exposed
 * as `{ ok: true, view }` (tagged by `kind`); a body matching no shape degrades to
 * `ok:false`. On any non-2xx the body is parsed against `ErrorResponse` so callers
 * can surface `fields` (undefined when the body is not an `ErrorResponse`). Never
 * throws.
 */
export async function postQuery(id: string, request: QueryRequest): Promise<PostQueryResult> {
  const { data, error, response } = await api.POST('/api/v1/keyword-analyses/{id}/query', {
    params: { path: { id } },
    // Body is under-documented in openapi (typed `Record<string, never>`); send the
    // real payload cast-free via the serializer, which openapi-fetch calls whenever
    // `body` is not undefined (`{}` satisfies the empty-record type).
    body: {},
    bodySerializer: () => JSON.stringify(request),
  });

  if (response.ok) {
    const parsed = QueryViewSchema.safeParse(data);
    if (parsed.success) {
      return { ok: true, view: parsed.data };
    }
    return { ok: false, status: response.status };
  }

  const parsedError = ErrorResponseSchema.safeParse(error);
  return {
    ok: false,
    status: response.status,
    error: parsedError.success ? parsedError.data : undefined,
  };
}

/**
 * The backend `/query` single-page cap (`QUERY_MAX_PAGE_SIZE`, Design §6.5, default 200):
 * `pageSize > this → 400` (query-view.service.ts / snapshot-query.service.ts). The frontend can't
 * read the backend env, so we page at exactly the documented default — safe because the check is
 * strict `>` (200 is allowed).
 */
const MAX_QUERY_PAGE_SIZE = 200;
/** Runaway guard for cursor-follow (500 × 200 = 100k rows, far above any real snapshot ~3,686). */
const MAX_QUERY_PAGES = 500;

/** The result of {@link postQueryAllPages}: every accumulated table row, or a fail-loud `ok:false`. */
export type PostQueryAllPagesResult =
  | { readonly ok: true; readonly rows: ReadonlyArray<Record<string, unknown>> }
  | { readonly ok: false; readonly status: number };

/**
 * Fetch EVERY page of a table-view `/query` by following `pagination.cursor` within the backend's
 * per-page cap (M7-R20, xhigh finding [0]). Needed by the 購買歷程主題 all-stages client-join, which
 * must cover every keyword's stage — the prior single `pageSize: 100_000` request was silently 400'd
 * by the cap, leaving the column stuck on shimmer. Each page requests exactly {@link
 * MAX_QUERY_PAGE_SIZE}; rows accumulate until `cursor` is null. Any page failing (`ok:false` or a
 * non-table shape), or the runaway guard tripping, → the whole call fails loud (`ok:false`) rather
 * than returning a partial/truncated map (which would reintroduce the M7-R12 "later-page keyword
 * shows —" bug). Never throws (delegates to {@link postQuery}).
 */
export async function postQueryAllPages(
  id: string,
  request: QueryRequest,
): Promise<PostQueryAllPagesResult> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | undefined = request.pagination?.cursor;
  for (let page = 0; page < MAX_QUERY_PAGES; page += 1) {
    const res = await postQuery(id, {
      ...request,
      pagination: { ...request.pagination, pageSize: MAX_QUERY_PAGE_SIZE, cursor },
    });
    if (!res.ok || res.view.kind !== 'table') {
      return { ok: false, status: res.ok ? 200 : res.status };
    }
    rows.push(...res.view.rows);
    const next = res.view.pagination.cursor;
    if (next === null) return { ok: true, rows };
    cursor = next;
  }
  // Runaway guard tripped (cursor never settled) — fail loud, never a truncated map.
  return { ok: false, status: 200 };
}
