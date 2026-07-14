import { z } from 'zod';

/**
 * URL-is-state serialization (Design §5 「URL 即狀態」; FR-1 / TC-11). Pure `core`
 * lib — **no React / no IO** — so it is exhaustively unit-testable and hits the
 * ≥90% core coverage gate. The authoritative UI state (analysisId / view /
 * pagination / filters) lives in the URL search params; this module is the
 * single serialize ↔ deserialize codec between the raw params and a typed,
 * validated `AppSearch`. It is also the router's `validateSearch` (see
 * `src/router.tsx`), so an unknown `view` / malformed `analysisId` in a shared
 * or refreshed URL normalises to a not-found (undefined) state instead of
 * crashing the app.
 */

/**
 * Known dashboard views (T1.1 placeholder allowlist). The authoritative set is
 * ultimately backend view-metadata driven (T3.1, `GET /views`) and dynamic
 * `custom:{cid}` views arrive at M5; for the shell we validate against a static
 * allowlist so an unknown `view` in the URL normalises to a not-found state.
 */
export const KNOWN_VIEWS = ['keywords', 'trend', 'intent', 'journey', 'history'] as const;
export type KnownView = (typeof KNOWN_VIEWS)[number];

/**
 * Authoritative UI state carried in the URL search params. `filters` is the
 * opaque serialized FilterSpec string: this module only round-trips the raw value
 * untouched, while the FilterSpec ↔ string mapping lives in the single
 * `lib/filterSpec` codec (`serializeFiltersToUrl` / `deserializeFiltersFromUrl`,
 * T2.5 / Design §6 C4) — the one place that bidirectional mapping may live.
 */
export interface AppSearch {
  readonly analysisId?: string;
  readonly view?: KnownView;
  readonly page?: number;
  readonly pageSize?: number;
  readonly cursor?: string;
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
  view: z.enum(KNOWN_VIEWS).optional().catch(undefined),
  page: pageNumber,
  pageSize: pageNumber,
  cursor: z.string().min(1).optional().catch(undefined),
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
  if (parsed.filters !== undefined) out.filters = parsed.filters;
  return out;
}
