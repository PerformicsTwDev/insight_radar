import { z } from 'zod';
import { api } from './client';

/**
 * Typed egress for `GET /api/v1/views` (T3.1, FR-1 / AC-1.2; backend FR-22 /
 * T9.4). Business code calls this — never a bare `fetch` (single-egress, Design
 * §2/§3).
 *
 * **openapi gap (deviation, documented):** the backend `openapi.json` types the
 * `ViewsController_list` 200 with **no** response body schema (`content: never`,
 * #392 class), so the codegen'd `paths` give us no shape. We therefore validate
 * the untyped body here with zod against the backend view-registry metadata
 * contract (backend `view-definition.ts` `ViewMetadata` / Design §17.1 / AC-22.2
 * as-built): `{ views: [{ name, grain, allowedSelect:[{key,type}], allowedFilters,
 * allowedSort, responseShape, requiresFeature }] }`. A body that fails the
 * contract degrades to `ok:false` so the caller can fall back (FR-1) rather than
 * render a half-parsed registry.
 *
 * The parse is **whole-envelope**: any single malformed view (a genuinely new
 * `responseShape`/`requiresFeature` enum value the codegen drift-check (NFR-2 /
 * TC-38) hasn't yet surfaced, or an incidental backend bug) degrades the *entire*
 * registry to the built-in fallback, not just that entry. That is deliberate — a
 * clearly-flagged degraded state beats silently serving a whitelist that is
 * missing entries — but note the blast radius is broader than "unknown enum only".
 */

/** `allowedSelect` element — a selectable column key + its type (backend `SelectField`, AC-22.2). */
const SelectFieldSchema = z.object({
  key: z.string(),
  // backend `ColumnType` (`ColumnDef['type']`).
  type: z.enum(['text', 'number', 'array']),
});

/**
 * Metadata for one view (backend `ViewMetadata`). `responseShape` reserves
 * `summary` for the M12+ KPI-card views (backend keeps it in the contract ahead
 * of use); `requiresFeature` is the as-built feature-gating field (AC-14.7). Both
 * are strict enums matching the current backend contract — a genuinely new enum
 * value is a contract change the codegen drift-check (NFR-2 / TC-38) surfaces, at
 * which point this boundary is regenerated/updated; that is distinct from AC-1.2's
 * "new *view* → zero **shared-component** change" (a new view *name* needs no code
 * change here, only new enum members do).
 */
export const ViewMetadataSchema = z.object({
  name: z.string().min(1),
  grain: z.string(),
  allowedSelect: z.array(SelectFieldSchema),
  allowedFilters: z.array(z.string()),
  allowedSort: z.array(z.string()),
  responseShape: z.enum(['table', 'trend', 'chart', 'summary']),
  requiresFeature: z.enum(['keyword_metrics', 'serp', 'topics']),
});
export type ViewMetadata = z.infer<typeof ViewMetadataSchema>;
export type SelectField = z.infer<typeof SelectFieldSchema>;

/** `GET /views` envelope: `{ views: ViewMetadata[] }` (backend `ViewsController.list`). */
export const ViewsResponseSchema = z.object({ views: z.array(ViewMetadataSchema) });

export type FetchViewsResult =
  | { readonly ok: true; readonly views: readonly ViewMetadata[] }
  | { readonly ok: false; readonly status: number };

/**
 * Fetch the view registry metadata. Egress via the typed `api` client (never a
 * bare fetch). On 2xx the (openapi-untyped) body is zod-validated against the
 * `{ views }` contract → `{ ok:true, views }`; a body matching neither the
 * envelope nor the per-view shape degrades to `ok:false` (the caller falls back).
 * On any non-2xx returns `{ ok:false, status }`.
 */
export async function fetchViews(): Promise<FetchViewsResult> {
  const { data, response } = await api.GET('/api/v1/views');
  if (response.ok) {
    const parsed = ViewsResponseSchema.safeParse(data);
    if (parsed.success) {
      return { ok: true, views: parsed.data.views };
    }
    return { ok: false, status: response.status };
  }
  return { ok: false, status: response.status };
}
