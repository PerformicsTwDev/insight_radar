import type { ErrorResponse } from './keywordAnalyses';

/**
 * RED shell (T2.1, TC-33). Real types; the two behaviours (`buildKeywordsQuery`,
 * `getKeywords`) are typed not-implemented placeholders so the contract tests are
 * assertion-red, not compile-red (附錄 B). Green wires the zod-validated egress.
 */

/** Result row (backend `KeywordListRow`, Design §6.4 / AC-6.1; nulls kept — 缺值≠0). */
export interface KeywordRow {
  text: string;
  intentLabels: string[];
  avgMonthlySearches: number | null;
  competition: string;
  competitionIndex: number | null;
  cpcLow: number | null;
  cpcHigh: number | null;
}

/** Pagination meta (backend `{ total, page, pageSize, cursor }`). */
export interface KeywordsMeta {
  total: number;
  page: number;
  pageSize: number;
  cursor: string | null;
}

/**
 * Query params for `GET :id/keywords`. Shape mirrors the backend
 * `FilterKeywordsQueryDto` (pagination + sort + FilterSpec subset). The openapi
 * op under-documents the query (only the `id` path param is described), so this
 * is the local SSOT for the query surface (T2.5/T2.6 consume the same egress).
 */
export interface GetKeywordsParams {
  readonly page?: number;
  readonly pageSize?: number;
  readonly cursor?: string;
  readonly sortBy?: 'avgMonthlySearches' | 'competitionIndex' | 'cpcLow' | 'cpcHigh' | 'text';
  readonly sortDir?: 'asc' | 'desc';
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

export type GetKeywordsResult =
  | { readonly ok: true; readonly rows: KeywordRow[]; readonly meta: KeywordsMeta }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

export function buildKeywordsQuery(_params: GetKeywordsParams): string {
  return '';
}

export function getKeywords(
  _id: string,
  _params: GetKeywordsParams = {},
): Promise<GetKeywordsResult> {
  return Promise.resolve({ ok: false, status: 0 });
}
