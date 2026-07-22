import { IDEATION_TEMPLATE_KEYS, IDEATION_TEMPLATES } from './ideation.templates';

/**
 * TC-71 (FR-35 修訂，§19 2026-07-23) — the AI 發想 template allowlist is the v4 10-angle
 * set. Each key maps to a **server-controlled** directive (non-empty; the prompt angle is
 * backend-owned, never free user text — S19 injection isolation). Locks the set + count so
 * a drift (rename / drop) is caught, and keeps the frontend `AI_IDEATION_TEMPLATES` (T7.11)
 * synced against a stable contract.
 */
describe('TC-71 · IDEATION_TEMPLATES (v4 10-angle set)', () => {
  it('exposes exactly the 10 v4 template keys, in order', () => {
    expect(IDEATION_TEMPLATE_KEYS).toEqual([
      'technical_terms',
      'pain_points',
      'subtopics',
      'competitor_comparison',
      'trends',
      'related_products',
      'buying_motivation',
      'cross_industry',
      'controversies',
      'myths',
    ]);
  });

  it('maps every key to a non-empty server-controlled directive', () => {
    for (const key of IDEATION_TEMPLATE_KEYS) {
      expect(IDEATION_TEMPLATES[key].length).toBeGreaterThan(0);
    }
  });
});
