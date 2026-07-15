import { z } from 'zod';
import { SORT_DIRS, SORT_FIELDS, type SortBy, type SortDir } from './pagination';

/**
 * URL-is-state serialization (Design §5 「URL 即狀態」; FR-1 / TC-11). Pure `core`
 * lib — **no React / no IO** — so it is exhaustively unit-testable and hits the
 * ≥90% core coverage gate. The authoritative UI state (analysisId / view /
 * pagination / filters) lives in the URL search params; this module is the
 * single serialize ↔ deserialize codec between the raw params and a typed,
 * validated `AppSearch`. It is also the router's `validateSearch` (see
 * `src/router.tsx`), so a malformed `analysisId` / empty `view` in a shared or
 * refreshed URL normalises to a not-found (undefined) state instead of crashing.
 *
 * `view` is any **non-empty string**, not a static allowlist: the authoritative
 * view set is backend view-metadata driven (T3.1, `GET /views` — AC-1.2), and
 * dynamic `custom:{cid}` views arrive at M5, so hardcoding view names here would
 * both go stale and contradict "new backend view → zero frontend change". Whether
 * a (syntactically valid) `view` actually exists is a **registry/runtime** concern
 * — an unknown view resolves to a not-found state once view content is routed
 * (T3.3); the codec only rejects a malformed (empty / non-string) value.
 */

/**
 * Authoritative UI state carried in the URL search params. `filters` is the
 * opaque serialized FilterSpec string: this module only round-trips the raw value
 * untouched, while the FilterSpec ↔ string mapping lives in the single
 * `lib/filterSpec` codec (`serializeFiltersToUrl` / `deserializeFiltersFromUrl`,
 * T2.5 / Design §6 C4) — the one place that bidirectional mapping may live.
 */
export interface AppSearch {
  readonly analysisId?: string;
  /** Any non-empty view name (registry-resolved, AC-1.2) — not a static enum. */
  readonly view?: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly cursor?: string;
  readonly sortBy?: SortBy;
  readonly sortDir?: SortDir;
  readonly filters?: string;
}

/** 1-based, positive integer pagination fields; anything else → undefined (dropped). */
const pageNumber = z.coerce.number().int().positive().optional().catch(undefined);

/**
 * Per-field `.catch(undefined)` makes every field self-normalising: a present
 * but invalid value (bad uuid, unknown view, non-numeric page) resolves to
 * `undefined` rather than throwing, and unknown keys are stripped by the object
 * schema. Deserializing therefore never throws (Design §5 / TC-11).
 */
const AppSearchSchema = z.object({
  analysisId: z.uuid().optional().catch(undefined),
  // Any non-empty string — the registry (GET /views) is the authoritative view set
  // (AC-1.2); a static enum here would go stale and block new backend views. An
  // empty / non-string value is malformed → undefined (not-found).
  view: z.string().min(1).optional().catch(undefined),
  page: pageNumber,
  pageSize: pageNumber,
  cursor: z.string().min(1).optional().catch(undefined),
  // Sort is part of the shared search schema (T2.6); an unknown column / direction
  // normalises to undefined (server default sort) rather than throwing (TC-11).
  sortBy: z.enum(SORT_FIELDS).optional().catch(undefined),
  sortDir: z.enum(SORT_DIRS).optional().catch(undefined),
  filters: z.string().min(1).optional().catch(undefined),
});

type MutableAppSearch = { -readonly [K in keyof AppSearch]: AppSearch[K] };

/**
 * Typed `AppSearch` → URL search-param record. Undefined fields are omitted so
 * they never appear as empty params, and numbers are stringified. The result is
 * a valid input to {@link deserialize}, giving `deserialize(serialize(s)) === s`
 * (deep-equal) for any valid state.
 */
export function serialize(state: AppSearch): Record<string, string> {
  const out: Record<string, string> = {};
  if (state.analysisId !== undefined) out.analysisId = state.analysisId;
  if (state.view !== undefined) out.view = state.view;
  if (state.page !== undefined) out.page = String(state.page);
  if (state.pageSize !== undefined) out.pageSize = String(state.pageSize);
  if (state.cursor !== undefined) out.cursor = state.cursor;
  if (state.sortBy !== undefined) out.sortBy = state.sortBy;
  if (state.sortDir !== undefined) out.sortDir = state.sortDir;
  if (state.filters !== undefined) out.filters = state.filters;
  return out;
}

/**
 * Raw URL search params → validated, normalised `AppSearch`. Coerces
 * string-number params back to numbers, drops unknown keys and undefined
 * fields, and normalises malformed values to a not-found (undefined) state.
 * Never throws — safe as the router's `validateSearch`.
 */
export function deserialize(raw: unknown): AppSearch {
  // 頂層 `.catch({})` 使非物件輸入（`null`/`42`/`[]`…）亦正規化為 `{}` 而非拋錯——per-field
  // `.catch(undefined)` 已處理欄位級無效值；此補頂層，使 codec 對**任意**輸入 never-throw
  // （此為通用 export，非僅 router `validateSearch` 用）。
  const parsed = AppSearchSchema.catch({}).parse(raw);
  const out: MutableAppSearch = {};
  if (parsed.analysisId !== undefined) out.analysisId = parsed.analysisId;
  if (parsed.view !== undefined) out.view = parsed.view;
  if (parsed.page !== undefined) out.page = parsed.page;
  if (parsed.pageSize !== undefined) out.pageSize = parsed.pageSize;
  if (parsed.cursor !== undefined) out.cursor = parsed.cursor;
  if (parsed.sortBy !== undefined) out.sortBy = parsed.sortBy;
  if (parsed.sortDir !== undefined) out.sortDir = parsed.sortDir;
  if (parsed.filters !== undefined) out.filters = parsed.filters;
  return out;
}
