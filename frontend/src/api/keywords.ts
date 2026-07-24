import { z } from 'zod';
import { api } from './client';
import type { FilterSpec } from '../lib/filterSpec';
import { ErrorResponseSchema, type ErrorResponse } from './keywordAnalyses';
import { postQuery, type QueryRequest } from './query';

/**
 * Typed egress for `GET /api/v1/keyword-analyses/:id/keywords` (T2.1, FR-4).
 * Business code calls this — never a bare `fetch` (single-egress, Design §2/§3).
 *
 * **openapi gaps (deviation, documented):** the backend `openapi.json` describes
 * this op with *only* the `id` path param and *no* response body schema (#392
 * class). So the codegen'd `paths` type the query as `never` and the body as
 * `never`. We therefore (a) bind the **path** to the generated op (a path drift
 * is a compile error) and zod-validate the untyped **response** body here, and
 * (b) serialize the **query** via a request-level `querySerializer` (openapi-fetch
 * always calls it in `createFinalURL`) — cast-free, since the query cannot be
 * passed through the `never`-typed `params.query`. The query shape's SSOT is the
 * backend `FilterKeywordsQueryDto`, mirrored in {@link GetKeywordsParams}.
 */

/**
 * One month of the trailing search-volume series (backend `MonthlySearchVolume`,
 * Design §9.2): `month` already mapped 1–12, `searches` kept null for a missing
 * month (斷點，never 0 — C12). Feeds the `搜尋趨勢` sparkline (FR-4 → FR-21).
 */
const MonthlyVolumeSchema = z.object({
  year: z.number(),
  month: z.number(),
  searches: z.number().nullable(),
});

/** Result row (backend `KeywordListRow`, Design §6.4 / AC-6.1; nulls kept — 缺值≠0). */
const KeywordRowSchema = z.object({
  text: z.string(),
  // The C7 dedup/cache key (backend-returned `normalizedText`; same key as selection /
  // tracking members). Optional: the current list DTO doesn't emit it yet (same documented
  // cross-spec gap as `monthlyVolumes`) — when it starts arriving, no frontend change is
  // needed. The ✦ on-demand cell (T4.1, FR-18) keys `POST :id/ai-intent-summary` on it; a
  // row without it → 400 (AC-31.2) → the cell's `invalid` state.
  normalizedText: z.string().optional(),
  intentLabels: z.array(z.string()),
  avgMonthlySearches: z.number().nullable(),
  competition: z.string(),
  competitionIndex: z.number().nullable(),
  cpcLow: z.number().nullable(),
  cpcHigh: z.number().nullable(),
  // 逐月搜量序列（drives 搜尋趨勢 sparkline, FR-4/FR-21）。缺月 searches=null 保留斷點（C12）。
  // NOTE (documented cross-spec gap): the current backend list DTO (`KeywordListRow`) does not
  // yet emit `monthlyVolumes`; it defaults to `[]` here so such a row renders the sparkline's
  // no-data state (never a fabricated 0 line). When backend:FR-6 adds it to the list row, no
  // frontend change is needed — the field simply starts arriving.
  monthlyVolumes: z.array(MonthlyVolumeSchema).default([]),
});

/** Pagination meta (backend `{ total, page, pageSize, cursor }`). */
const KeywordsMetaSchema = z.object({
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  cursor: z.string().nullable(),
});

/** Full body (backend returns `{ data, meta }`; exposed to callers as `{ rows, meta }`). */
const KeywordsListSchema = z.object({
  data: z.array(KeywordRowSchema),
  meta: KeywordsMetaSchema,
});

export type KeywordRow = z.infer<typeof KeywordRowSchema>;
export type KeywordsMeta = z.infer<typeof KeywordsMetaSchema>;
export type MonthlyVolume = z.infer<typeof MonthlyVolumeSchema>;

/**
 * Query params for `GET :id/keywords`. Mirrors the backend `FilterKeywordsQueryDto`
 * = the shared `FilterSpec` (single source in `lib/filterSpec`, T2.5) + list-only
 * pagination / sort. Extending the canonical `FilterSpec` keeps the filter surface
 * unified with `/query` and the chips↔URL codec (no divergent copy).
 */
export interface GetKeywordsParams extends FilterSpec {
  readonly page?: number;
  readonly pageSize?: number;
  readonly cursor?: string;
  readonly sortBy?: 'avgMonthlySearches' | 'competitionIndex' | 'cpcLow' | 'cpcHigh' | 'text';
  readonly sortDir?: 'asc' | 'desc';
}

export type GetKeywordsResult =
  | { readonly ok: true; readonly rows: KeywordRow[]; readonly meta: KeywordsMeta }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

/**
 * Append one query param. `undefined` and empty strings are dropped (empty ≠ 0 —
 * an empty filter must not become a real bound, mirroring the backend's
 * `toOptionalNumber`/`toArray`, M5-R1). Arrays serialize as repeated params.
 */
function appendParam(
  sp: URLSearchParams,
  key: string,
  value: string | number | readonly string[] | undefined,
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value === 'string') {
    if (value !== '') {
      sp.append(key, value);
    }
    return;
  }
  if (typeof value === 'number') {
    sp.append(key, String(value));
    return;
  }
  for (const item of value) {
    if (item !== '') {
      sp.append(key, item);
    }
  }
}

/** Serialize {@link GetKeywordsParams} to a query string (pure; unit + contract tested). */
export function buildKeywordsQuery(params: GetKeywordsParams): string {
  const sp = new URLSearchParams();
  appendParam(sp, 'page', params.page);
  appendParam(sp, 'pageSize', params.pageSize);
  appendParam(sp, 'cursor', params.cursor);
  appendParam(sp, 'sortBy', params.sortBy);
  appendParam(sp, 'sortDir', params.sortDir);
  appendParam(sp, 'q', params.q);
  appendParam(sp, 'intent', params.intent);
  appendParam(sp, 'intentMode', params.intentMode);
  appendParam(sp, 'competition', params.competition);
  appendParam(sp, 'volumeMin', params.volumeMin);
  appendParam(sp, 'volumeMax', params.volumeMax);
  appendParam(sp, 'competitionIndexMin', params.competitionIndexMin);
  appendParam(sp, 'competitionIndexMax', params.competitionIndexMax);
  appendParam(sp, 'cpcMin', params.cpcMin);
  appendParam(sp, 'cpcMax', params.cpcMax);
  return sp.toString();
}

/**
 * List a snapshot's keywords. Egress via the typed `api` client (never a bare
 * fetch). On 2xx the (untyped-in-openapi) `{ data, meta }` body is zod-validated
 * and exposed as `{ ok: true, rows, meta }`; a body that fails validation degrades
 * to `ok:false`. On any non-2xx the body is parsed against `ErrorResponse` so
 * callers can surface `fields` (undefined when the body is not an `ErrorResponse`).
 * Never throws.
 */
export async function getKeywords(
  id: string,
  params: GetKeywordsParams = {},
): Promise<GetKeywordsResult> {
  const { data, error, response } = await api.GET('/api/v1/keyword-analyses/{id}/keywords', {
    params: { path: { id } },
    // Query is under-documented in openapi (typed `never`); inject it cast-free
    // via the serializer, which openapi-fetch always calls in createFinalURL.
    querySerializer: () => buildKeywordsQuery(params),
  });

  if (response.ok) {
    const parsed = KeywordsListSchema.safeParse(data);
    if (parsed.success) {
      return { ok: true, rows: parsed.data.data, meta: parsed.data.meta };
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
 * The keywords-VIEW columns always selected (M7-R1). Beyond the lean `GET /keywords` fields it
 * adds `normalizedText` (the C7 selection / tracking-member key) and `monthlyVolumes` (the
 * 搜尋趨勢TTM sparkline series) — which the list DTO deliberately omits (AC-6.1) but the view
 * carries (AC-5.1). `intent` is the raw label array the list renames to `intentLabels`.
 */
const KEYWORDS_VIEW_SELECT = [
  'text',
  'normalizedText',
  'intent',
  'avgMonthlySearches',
  'competition',
  'competitionIndex',
  'cpcLow',
  'cpcHigh',
  'monthlyVolumes',
] as const;

/**
 * One `keywords`-view row (backend `pick(SnapshotRowData, select)`): raw `intent` (array), not the
 * list DTO's renamed `intentLabels`, plus `normalizedText` + `monthlyVolumes`. Transformed to the
 * {@link KeywordRow} the table consumes so the presentational table needs no change.
 */
const KeywordViewRowSchema = z
  .object({
    text: z.string(),
    normalizedText: z.string().optional(),
    intent: z.array(z.string()).default([]),
    avgMonthlySearches: z.number().nullable().default(null),
    competition: z.string().default(''),
    competitionIndex: z.number().nullable().default(null),
    cpcLow: z.number().nullable().default(null),
    cpcHigh: z.number().nullable().default(null),
    monthlyVolumes: z.array(MonthlyVolumeSchema).default([]),
  })
  .transform((r): KeywordRow => ({
    text: r.text,
    normalizedText: r.normalizedText,
    intentLabels: r.intent,
    avgMonthlySearches: r.avgMonthlySearches,
    competition: r.competition,
    competitionIndex: r.competitionIndex,
    cpcLow: r.cpcLow,
    cpcHigh: r.cpcHigh,
    monthlyVolumes: r.monthlyVolumes,
  }));

/**
 * List a snapshot's keywords via the view-router (`POST :id/query {view:'keywords'}`) rather than
 * the lean `GET :id/keywords` (M7-R1). The view carries `monthlyVolumes` + `normalizedText`
 * (AC-5.1/AC-6.1), so the table's 搜尋趨勢TTM sparkline and FR-19 selection have their data. Same
 * `{ ok, rows: KeywordRow[], meta }` shape as {@link getKeywords} — a drop-in. The generic view
 * rows are mapped to `KeywordRow` (`intent`→`intentLabels`); an unparseable row is dropped rather
 * than failing the whole page. Never throws.
 */
export async function getKeywordsView(
  id: string,
  params: GetKeywordsParams = {},
): Promise<GetKeywordsResult> {
  const { page, pageSize, cursor, sortBy, sortDir, ...filters } = params;
  const request: QueryRequest = {
    view: 'keywords',
    select: [...KEYWORDS_VIEW_SELECT],
    filters,
    sort: sortBy && sortDir ? [{ field: sortBy, direction: sortDir }] : undefined,
    pagination: { page, pageSize, cursor },
  };
  const res = await postQuery(id, request);
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.error };
  }
  if (res.view.kind !== 'table') {
    return { ok: false, status: 200 };
  }
  const rows = res.view.rows.flatMap((row) => {
    const parsed = KeywordViewRowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  return { ok: true, rows, meta: res.view.pagination };
}
