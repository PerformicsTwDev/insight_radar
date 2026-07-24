/**
 * Pure view-content resolution (T6.0, FR-1 / AC-1.2). **No React / no IO** → core
 * `src/lib/**` (≥90% gate). The single point that turns a URL `view` param + the
 * authoritative registry view set (from `GET /views`, T3.1) into a content
 * decision, WITHOUT a hardcoded view-name allowlist: a newly-registered backend
 * view resolves as `known` with zero change here (AC-1.2). The dashboard
 * (`features/dashboard/ViewContent`) maps the decision to a concrete standalone
 * view component; an unknown-but-valid string view lands on `not_found` (the FR-1
 * boundary — a non-blank not-found state, never a blank page / crash).
 *
 * `view` is expected to already be the codec-normalised value (`lib/urlState`): a
 * malformed (empty / non-string) view is undefined by the time it reaches here.
 * This function is nonetheless total — an empty string is treated as "no view".
 */

/** The `custom:{cid}` dynamic-view convention (see `lib/customView`). */
const CUSTOM_PREFIX = 'custom:';

/**
 * The resolved view decision:
 * - `default` — no view → the default keywords grand table.
 * - `known` — a registry view name (render its standalone component / a generic
 *   by-shape fallback when no bespoke component exists).
 * - `custom` — a dynamic `custom:{cid}` classification view.
 * - `not_found` — a syntactically valid but unknown view (FR-1 not-found boundary).
 */
export type ViewResolution =
  | { readonly kind: 'default' }
  | { readonly kind: 'known'; readonly view: string }
  | { readonly kind: 'custom'; readonly cid?: string }
  | { readonly kind: 'not_found'; readonly view: string };

/**
 * Classify a `view` param against the authoritative registry set + the
 * `custom:{cid}` convention. Order: no view → default; `custom:{cid}` (non-empty
 * cid) → custom; a name in `known` → known; otherwise → not_found. `known` is the
 * live registry view-name set (`GET /views`), never a hardcoded list, so a new
 * backend view is `known` automatically (AC-1.2).
 */
export function resolveView(view: string | undefined, known: ReadonlySet<string>): ViewResolution {
  if (!view) {
    return { kind: 'default' };
  }
  // A bare `custom` (the 自訂分類 nav dimension, M7-R7b) opens CustomClassifyView on its empty
  // create-state; a `custom:{cid}` deep-link opens that classification's dynamic table.
  if (view === 'custom') {
    return { kind: 'custom' };
  }
  if (view.startsWith(CUSTOM_PREFIX)) {
    const cid = view.slice(CUSTOM_PREFIX.length);
    return cid.length > 0 ? { kind: 'custom', cid } : { kind: 'not_found', view };
  }
  if (known.has(view)) {
    return { kind: 'known', view };
  }
  return { kind: 'not_found', view };
}
