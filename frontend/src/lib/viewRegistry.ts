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
  journey: '購買歷程',
};

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
    navItems: configs.map(({ name, label, responseShape, requiresFeature }) => ({
      name,
      label,
      responseShape,
      requiresFeature,
    })),
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
