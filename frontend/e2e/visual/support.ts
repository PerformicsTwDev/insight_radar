import type { Page } from '@playwright/test';
import { stubViews } from '../support/stubs';

/**
 * Shared fixtures for the T6.3 visual-regression specs (TC-49~54). These reuse the
 * T6.4 route-stub helpers (`../support/stubs`) to drive each routed view to its
 * ready state against the production preview build (no live backend), then screenshot
 * a **stable, dynamic-region-free element** (the table / chart / funnel / form) so the
 * golden is deterministic. See `./README.md` + `.claude/rules/visual-regression.md`.
 */

/**
 * The view registry the dashboard nav + view-content routing (T6.0) resolves against,
 * mirroring the msw handlers / backend `BUILTIN_VIEWS` so `view=trend` and
 * `view=journey_funnel` resolve as **known** views (not the FR-1 not-found). Passed to
 * the T6.4 {@link stubViews} helper. `requiresFeature` must stay within the FE
 * `api/views.ts` enum (`keyword_metrics` / `topics` / `journey`) — an out-of-enum value
 * degrades the *whole* registry to the built-in fallback (the T6.0 drift lesson, #443),
 * which would silently route `trend` / `journey_funnel` to a fallback list.
 */
export const FULL_VIEWS = [
  {
    name: 'keywords',
    grain: 'keyword',
    allowedSelect: [],
    allowedFilters: ['q', 'volumeMin', 'volumeMax', 'competition', 'intent', 'intentMode'],
    allowedSort: ['avgMonthlySearches', 'competitionIndex', 'cpcLow', 'cpcHigh', 'text'],
    responseShape: 'table',
    requiresFeature: 'keyword_metrics',
  },
  {
    name: 'trend',
    grain: 'month',
    allowedSelect: [],
    allowedFilters: ['q', 'volumeMin', 'volumeMax', 'intent', 'intentMode'],
    allowedSort: [],
    responseShape: 'trend',
    requiresFeature: 'keyword_metrics',
  },
  {
    name: 'intent_topics',
    grain: 'topic',
    allowedSelect: [],
    allowedFilters: [],
    allowedSort: [],
    responseShape: 'table',
    requiresFeature: 'topics',
  },
  {
    name: 'journey',
    grain: 'keyword',
    allowedSelect: [],
    allowedFilters: [],
    allowedSort: [],
    responseShape: 'table',
    requiresFeature: 'journey',
  },
  {
    name: 'journey_funnel',
    grain: 'journeyStage',
    allowedSelect: [],
    allowedFilters: [],
    allowedSort: [],
    responseShape: 'chart',
    requiresFeature: 'journey',
  },
] as const;

/** Stub `GET /views` with the full registry (so every routed view resolves as known). */
export function stubFullViews(page: Page): Promise<void> {
  return stubViews(page, FULL_VIEWS);
}

/**
 * A completed-analysis snapshot with a `features` gate map (T6.0). `getKeywordAnalysisStatus`
 * reads `status` + `features`; a `completed` status routes the URL `view` to content, and the
 * `features` map gates the topics / journey views (`ready` → content, `not_generated` → CTA).
 */
export function completedSnapshot(features: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: 'completed', features };
}

/**
 * 圖表-class pixel tolerance (rule §3: 「圖表類放寬 0.05」). Canvas charts (Chart.js
 * sub-pixel AA) and the data-viz DOM funnel / treemap use this looser ratio than the
 * global 0.01; a crisp table / form / chip golden keeps the global default.
 */
export const CHART_DIFF = { maxDiffPixelRatio: 0.05 } as const;
