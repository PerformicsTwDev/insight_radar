import { describe, expect, it } from 'vitest';
import type { ViewMetadata } from '../api/views';
import {
  FALLBACK_VIEWS,
  buildViewRegistry,
  labelForView,
  resolveViewRegistry,
} from './viewRegistry';

/**
 * TC-37 (contract) — pure view-registry derivation (T3.1, FR-1 / AC-1.2). Metadata
 * → nav config + per-view column/filter/sort; a newly-registered backend view
 * surfaces with zero code change (AC-1.2); `GET /views` failure → built-in
 * fallback + degraded flag (FR-1).
 */

/** Build a `ViewMetadata` with sane defaults, overriding only what a case cares about. */
const meta = (over: Partial<ViewMetadata> & { name: string }): ViewMetadata => ({
  grain: 'keyword',
  allowedSelect: [],
  allowedFilters: [],
  allowedSort: [],
  responseShape: 'table',
  requiresFeature: 'keyword_metrics',
  ...over,
});

describe('TC-37 · labelForView', () => {
  it('maps known view names to their zh label', () => {
    expect(labelForView('keywords')).toBe('搜尋詞總表');
    expect(labelForView('intent_topics')).toBe('意圖主題');
    expect(labelForView('journey')).toBe('購買歷程主題');
  });

  it('falls back to the raw name for an unknown (newly-registered) view — AC-1.2', () => {
    expect(labelForView('brand_ai_visibility')).toBe('brand_ai_visibility');
  });
});

describe('TC-37 · buildViewRegistry (metadata → nav + column/filter/sort config)', () => {
  const views = [
    meta({
      name: 'keywords',
      allowedSelect: [
        { key: 'text', type: 'text' },
        { key: 'avgMonthlySearches', type: 'number' },
      ],
      allowedFilters: ['q', 'volumeMin'],
      allowedSort: ['avgMonthlySearches'],
    }),
    // A top-level dimension (not an embedded/secondary view — those are covered by the
    // TC-58 taxonomy block below, which asserts trend/intent_distribution/… are hidden).
    meta({ name: 'intent_topics', responseShape: 'table', requiresFeature: 'topics' }),
  ];
  const registry = buildViewRegistry(views);

  it('derives the ordered nav list (name + label + shape + feature)', () => {
    expect(registry.navItems).toEqual([
      {
        name: 'keywords',
        label: '搜尋詞總表',
        responseShape: 'table',
        requiresFeature: 'keyword_metrics',
      },
      {
        name: 'intent_topics',
        label: '意圖主題',
        responseShape: 'table',
        requiresFeature: 'topics',
      },
    ]);
  });

  it('derives per-view column config from allowedSelect (T2.1 consumes)', () => {
    expect(registry.byName.get('keywords')?.columns).toEqual([
      { key: 'text', type: 'text' },
      { key: 'avgMonthlySearches', type: 'number' },
    ]);
  });

  it('carries allowedFilters / allowedSort through per view (T2.5/T2.6 consume)', () => {
    expect(registry.byName.get('keywords')?.allowedFilters).toEqual(['q', 'volumeMin']);
    expect(registry.byName.get('keywords')?.allowedSort).toEqual(['avgMonthlySearches']);
  });

  it('auto-includes a newly-registered backend view with ZERO code change (AC-1.2)', () => {
    const withJourney = buildViewRegistry([
      ...views,
      meta({ name: 'journey', responseShape: 'chart' }),
    ]);
    expect(withJourney.navItems.map((n) => n.name)).toContain('journey');
    expect(withJourney.byName.get('journey')?.label).toBe('購買歷程主題');

    // even a brand-new, unlabelled view surfaces — its label defaults to the name.
    const withUnknown = buildViewRegistry([...views, meta({ name: 'foo_bar' })]);
    expect(withUnknown.byName.get('foo_bar')?.label).toBe('foo_bar');
  });
});

describe('TC-58〔taxonomy〕· nav collapses embedded/secondary views (v4 IA, T7.3)', () => {
  const registry = buildViewRegistry([
    meta({ name: 'keywords' }),
    meta({ name: 'trend', responseShape: 'trend' }),
    meta({ name: 'intent_distribution', responseShape: 'chart' }),
    meta({ name: 'cpc_histogram', responseShape: 'chart' }),
    meta({ name: 'serp_questions', requiresFeature: 'serp' }),
    meta({ name: 'intent_topics', requiresFeature: 'topics' }),
    meta({ name: 'journey', requiresFeature: 'journey' }),
    meta({ name: 'journey_funnel', responseShape: 'chart', requiresFeature: 'journey' }),
    // an unknown, newly-registered backend view still surfaces top-level (AC-1.2 守恆).
    meta({ name: 'new_dimension' }),
  ]);

  it('shows only the collapsed top-level dimensions in the nav (trend/intent_distribution/cpc_histogram/journey_funnel/serp_questions hidden)', () => {
    expect(registry.navItems.map((n) => n.name)).toEqual([
      'keywords',
      'intent_topics',
      'journey',
      'new_dimension',
    ]);
  });

  it('keeps every view in byName so embedded views stay URL-resolvable (T7.4 embeds them)', () => {
    for (const name of ['trend', 'intent_distribution', 'cpc_histogram', 'journey_funnel']) {
      expect(registry.byName.get(name)).toBeDefined();
    }
  });
});

describe('TC-37 · resolveViewRegistry (fetch result → registry + degraded)', () => {
  it('uses the fetched views and is NOT degraded on success', () => {
    const resolved = resolveViewRegistry({ ok: true, views: [meta({ name: 'keywords' })] });
    expect(resolved.degraded).toBe(false);
    expect(resolved.registry.navItems.map((n) => n.name)).toEqual(['keywords']);
  });

  it('falls back to the built-in list and flags degraded on failure (FR-1)', () => {
    const resolved = resolveViewRegistry({ ok: false, status: 500 });
    expect(resolved.degraded).toBe(true);
    expect(resolved.registry.navItems.map((n) => n.name)).toContain('keywords');
  });
});

describe('TC-37 · FALLBACK_VIEWS (built-in degraded list)', () => {
  it('includes the primary keywords table view with usable columns', () => {
    const keywords = FALLBACK_VIEWS.find((v) => v.name === 'keywords');
    expect(keywords).toBeDefined();
    expect(keywords?.responseShape).toBe('table');
    expect(keywords?.allowedSelect.length).toBeGreaterThan(0);
  });
});
