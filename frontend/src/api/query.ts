import { z } from 'zod';
import { api } from './client';
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
 * zod-validate the untyped **response** body here against the view-router
 * contract (backend `view-definition.ts`): a structural union over the three
 * response shapes (table | trend | chart), tagged with a `kind` discriminant.
 */

// STUB (red): typed not-implemented shell so TC-34 imports resolve and fail on
// assertions, not on compile. Real implementation lands in the green commit.

/** Shared `FilterSpec` subset (backend `FilterSpecDto`) — the `/query` body's `filters`. */
export interface QueryFilters {
  readonly q?: string;
  readonly intent?: readonly string[];
  readonly intentMode?: 'any' | 'all';
  readonly competition?: readonly string[];
  readonly volumeMin?: number;
  readonly volumeMax?: number;
  readonly competitionIndexMin?: number;
  readonly competitionIndexMax?: number;
  readonly cpcMin?: number;
  readonly cpcMax?: number;
}

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

/** table view: `{ view, columns, rows, pagination }` (backend `TableViewResult`). */
export type TableView = {
  readonly kind: 'table';
  readonly view: string;
  readonly columns: { key: string; label: string; type: 'text' | 'number' | 'array' }[];
  readonly rows: Record<string, unknown>[];
  readonly pagination: { total: number; page: number; pageSize: number; cursor: string | null };
};

/** trend view: `{ view, axis, total, series }` (backend `TrendViewResult`). */
export type TrendView = {
  readonly kind: 'trend';
  readonly view: string;
  readonly axis: string[];
  readonly total: number[];
  readonly series: { keyword: string; points: (number | null)[] }[];
};

/** chart view: `{ view, groups, meta }` (backend `ChartViewResult`). */
export type ChartView = {
  readonly kind: 'chart';
  readonly view: string;
  readonly groups: {
    key: Record<string, string | number>;
    measures: Record<string, number | null>;
  }[];
  readonly meta: { total: number; truncated: boolean };
};

export type QueryView = TableView | TrendView | ChartView;

export type PostQueryResult =
  | { readonly ok: true; readonly view: QueryView }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

// Placeholder schema so the export exists for the red import (unused until green).
export const QueryViewSchema = z.unknown();

export async function postQuery(_id: string, _request: QueryRequest): Promise<PostQueryResult> {
  return { ok: false, status: 0 };
}
