import { describe, expect, it } from 'vitest';
import { resolveView } from './viewResolve';

/**
 * TC-11 (FR-1 / AC-1.2) — the registry-driven view→content resolution single
 * point. A syntactically valid `view` param is classified against the authoritative
 * registry view set (from `GET /views`, passed as `known`) + the `custom:{cid}`
 * convention, WITHOUT a hardcoded view-name allowlist (a new backend view resolves
 * with zero change here). An unknown-but-valid string resolves to `not_found` (the
 * FR-1 boundary — non-blank, not a crash); no `view` → the default (keywords).
 */

const KNOWN = new Set(['keywords', 'trend', 'intent_topics', 'journey', 'journey_funnel']);

describe('resolveView (registry-driven view resolution — AC-1.2)', () => {
  it('resolves an absent view to the default (keywords table)', () => {
    expect(resolveView(undefined, KNOWN)).toEqual({ kind: 'default' });
  });

  it('resolves a known registry view to `known` with the view name (no hardcoded allowlist)', () => {
    expect(resolveView('keywords', KNOWN)).toEqual({ kind: 'known', view: 'keywords' });
    expect(resolveView('trend', KNOWN)).toEqual({ kind: 'known', view: 'trend' });
    expect(resolveView('intent_topics', KNOWN)).toEqual({ kind: 'known', view: 'intent_topics' });
    expect(resolveView('journey', KNOWN)).toEqual({ kind: 'known', view: 'journey' });
    expect(resolveView('journey_funnel', KNOWN)).toEqual({
      kind: 'known',
      view: 'journey_funnel',
    });
  });

  it('resolves a newly-registered view purely from the passed registry set (zero code change)', () => {
    const known = new Set([...KNOWN, 'brand_ai_visibility']);
    expect(resolveView('brand_ai_visibility', known)).toEqual({
      kind: 'known',
      view: 'brand_ai_visibility',
    });
  });

  it('resolves a custom:{cid} view to `custom` with the cid (dynamic, not in the registry)', () => {
    expect(resolveView('custom:abc123', KNOWN)).toEqual({ kind: 'custom', cid: 'abc123' });
  });

  it('resolves a bare `custom` view to the custom create-state (no cid, M7-R7b)', () => {
    expect(resolveView('custom', KNOWN)).toEqual({ kind: 'custom' });
  });

  it('treats a custom: view with an empty cid as not_found (malformed custom name)', () => {
    expect(resolveView('custom:', KNOWN)).toEqual({ kind: 'not_found', view: 'custom:' });
  });

  it('resolves an unknown-but-valid string view to not_found (FR-1 boundary)', () => {
    expect(resolveView('bogus', KNOWN)).toEqual({ kind: 'not_found', view: 'bogus' });
    expect(resolveView('intent_distribution', new Set(['keywords']))).toEqual({
      kind: 'not_found',
      view: 'intent_distribution',
    });
  });

  it('resolves an empty-string view to the default (mirrors the codec’s malformed→undefined)', () => {
    // The urlState codec already normalises a malformed (empty) view to undefined, but
    // resolveView must also be total: an empty string is treated as "no view" (default).
    expect(resolveView('', KNOWN)).toEqual({ kind: 'default' });
  });
});
