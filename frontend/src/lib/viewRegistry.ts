import type { FetchViewsResult, ViewMetadata } from '../api/views';

/**
 * Pure view-registry derivation (T3.1, FR-1 / AC-1.2; NFR-10 closed loop). Turns
 * `GET /views` metadata into the dashboard's nav-item list + per-view column /
 * filter / sort config, so a newly-registered backend `ViewDefinition` surfaces in
 * the UI with **zero shared-component change**. No React / no IO → core
 * `src/lib/**` (≥90% gate). The API boundary + fetch live in `api/views.ts`; the
 * `useViews` hook (`features/views`) wires this to TanStack Query with fallback.
 */

/**
 * zh display labels for known view names. A name absent here falls back to the
 * raw name (see {@link labelForView}), so a newly-registered backend view still
 * appears in the nav without a code change (AC-1.2). Dynamic custom-classification
 * views (M5) carry their own labels via metadata and are not enumerated here.
 */
export const VIEW_LABELS: Readonly<Record<string, string>> = {
  keywords: '搜尋詞總表',
  trend: '搜尋趨勢',
  intent_distribution: '意圖分佈',
  cpc_histogram: 'CPC 分佈',
  serp_questions: 'SERP 問題',
  intent_topics: '意圖主題',
  journey: '購買歷程主題',
  journey_funnel: '購買歷程漏斗',
  custom: '自訂分類',
};

/**
 * The 自訂分類 dimension (M7-R7b, TC-58): a synthetic top-level nav item. Custom
 * classifications are dynamic (`custom:{cid}`), so `GET /views` never lists a bare `custom`
 * view — but the dimension must still appear in the left menu; selecting it opens
 * {@link CustomClassifyView}'s empty create-state (`?view=custom`, resolved by `resolveView`).
 */
const CUSTOM_NAV_ITEM: ViewNavItem = {
  name: 'custom',
  label: VIEW_LABELS.custom,
  responseShape: 'table',
  // Custom classification needs the base keyword analysis; the per-classification run is gated
  // dynamically inside CustomClassifyView (409 per cid), not by a static feature here.
  requiresFeature: 'keyword_metrics',
};

/**
 * Secondary / embedded views hidden from the collapsed v4 left-menu taxonomy (T7.3,
 * TC-58〔taxonomy〕). These are surfaced WITHIN their parent dimension, not as their own
 * top-level menu item: 趨勢 / 意圖分佈 / CPC 分佈 live inside the 搜尋詞總表 page (T7.4);
 * 購買歷程漏斗 is the 購買歷程主題 view's own 表格|漏斗 toggle. They stay in the registry's
 * `byName` map (so they remain URL-resolvable — the funnel deep-link, the T7.4 embeds),
 * only the nav LIST drops them. A denylist (not an allowlist) keeps AC-1.2: a
 * newly-registered backend view is NOT embedded → it still surfaces top-level with zero
 * code change here.
 */
const EMBEDDED_VIEWS: ReadonlySet<string> = new Set([
  'trend',
  'intent_distribution',
  'cpc_histogram',
  'journey_funnel',
  'serp_questions',
]);

/** A selectable column derived from a view's `allowedSelect` (key + type). */
export interface ViewColumn {
  readonly key: string;
  readonly type: 'text' | 'number' | 'array';
}

/** A left-menu / tab entry derived from view metadata (the AC-1.2 nav config). */
export interface ViewNavItem {
  readonly name: string;
  readonly label: string;
  readonly responseShape: ViewMetadata['responseShape'];
  readonly requiresFeature: ViewMetadata['requiresFeature'];
}

/** Full per-view config: nav fields + the column / filter / sort whitelists (T2.1/T2.5/T2.6 consume). */
export interface ViewConfig extends ViewNavItem {
  readonly columns: readonly ViewColumn[];
  readonly allowedFilters: readonly string[];
  readonly allowedSort: readonly string[];
}

/** The derived registry: an ordered nav list + a by-name config lookup. */
export interface ViewRegistry {
  readonly navItems: readonly ViewNavItem[];
  readonly byName: ReadonlyMap<string, ViewConfig>;
}

/** A registry plus whether it is the built-in fallback (`GET /views` failed → hint the user). */
export interface ResolvedRegistry {
  readonly registry: ViewRegistry;
  readonly degraded: boolean;
}

/** Known view name → zh label; unknown (newly-registered) name → the name itself (AC-1.2). */
export function labelForView(name: string): string {
  return VIEW_LABELS[name] ?? name;
}

/** Derive the registry (nav list + per-view config) from view metadata. */
export function buildViewRegistry(views: readonly ViewMetadata[]): ViewRegistry {
  const configs: ViewConfig[] = views.map((view) => ({
    name: view.name,
    label: labelForView(view.name),
    responseShape: view.responseShape,
    requiresFeature: view.requiresFeature,
    columns: view.allowedSelect.map((field) => ({ key: field.key, type: field.type })),
    allowedFilters: view.allowedFilters,
    allowedSort: view.allowedSort,
  }));
  return {
    // Nav LIST collapses to the top-level v4 dimensions (embedded views hidden, T7.3);
    // `byName` keeps EVERY view so embedded ones stay URL-resolvable / T7.4-embeddable.
    navItems: [
      ...configs
        .filter((config) => !EMBEDDED_VIEWS.has(config.name))
        .map(({ name, label, responseShape, requiresFeature }) => ({
          name,
          label,
          responseShape,
          requiresFeature,
        })),
      // Append the synthetic 自訂分類 dimension unless the backend already lists a `custom` view
      // (dedupe keeps AC-1.2: a real backend `custom` view would win, no double entry).
      ...(configs.some((config) => config.name === 'custom') ? [] : [CUSTOM_NAV_ITEM]),
    ],
    byName: new Map(configs.map((config) => [config.name, config])),
  };
}

/**
 * Built-in fallback view list used when `GET /views` is unreachable/invalid
 * (FR-1). Best-effort mirror of the shipped backend views so the dashboard stays
 * usable (the primary keywords table keeps its real columns) in degraded mode.
 */
export const FALLBACK_VIEWS: readonly ViewMetadata[] = [
  {
    name: 'keywords',
    grain: 'keyword',
    responseShape: 'table',
    requiresFeature: 'keyword_metrics',
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
    // backend FILTER_KEYS / SORT_FIELDS (keywords view) — best-effort for degraded mode.
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
  },
  {
    name: 'trend',
    grain: 'month',
    responseShape: 'trend',
    requiresFeature: 'keyword_metrics',
    allowedSelect: [],
    allowedFilters: ['q', 'volumeMin', 'volumeMax', 'intent', 'intentMode'],
    allowedSort: [],
  },
  {
    name: 'intent_distribution',
    grain: 'intentLabel',
    responseShape: 'chart',
    requiresFeature: 'keyword_metrics',
    allowedSelect: [],
    allowedFilters: ['q', 'volumeMin', 'volumeMax', 'intent', 'intentMode'],
    allowedSort: [],
  },
  {
    name: 'cpc_histogram',
    grain: 'bucket',
    responseShape: 'chart',
    requiresFeature: 'keyword_metrics',
    allowedSelect: [],
    allowedFilters: ['q', 'volumeMin', 'volumeMax'],
    allowedSort: [],
  },
  {
    name: 'serp_questions',
    grain: 'entity',
    responseShape: 'table',
    requiresFeature: 'serp',
    allowedSelect: [],
    allowedFilters: [],
    allowedSort: [],
  },
  {
    name: 'intent_topics',
    grain: 'topic',
    responseShape: 'table',
    requiresFeature: 'topics',
    allowedSelect: [],
    allowedFilters: [],
    allowedSort: [],
  },
  {
    name: 'journey',
    grain: 'keyword',
    responseShape: 'table',
    requiresFeature: 'journey',
    allowedSelect: [],
    allowedFilters: [],
    allowedSort: [],
  },
  {
    name: 'journey_funnel',
    grain: 'journeyStage',
    responseShape: 'chart',
    requiresFeature: 'journey',
    allowedSelect: [],
    allowedFilters: [],
    allowedSort: [],
  },
];

/** The fallback registry (built once from {@link FALLBACK_VIEWS}). */
export const FALLBACK_REGISTRY: ViewRegistry = buildViewRegistry(FALLBACK_VIEWS);

/**
 * Resolve a fetch result to a registry + degraded flag: success → the fetched
 * registry (not degraded); failure → the built-in {@link FALLBACK_REGISTRY} with
 * `degraded:true` so the UI can show a fallback notice (FR-1). An empty-but-200
 * `views` list is a valid (if unusual) backend response, not a failure, so it is
 * used as-is rather than forced to fallback.
 */
export function resolveViewRegistry(result: FetchViewsResult): ResolvedRegistry {
  if (result.ok) {
    return { registry: buildViewRegistry(result.views), degraded: false };
  }
  return { registry: FALLBACK_REGISTRY, degraded: true };
}
