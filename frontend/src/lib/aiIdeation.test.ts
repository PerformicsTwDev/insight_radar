import { describe, expect, it } from 'vitest';
import {
  AI_IDEATION_TEMPLATES,
  appendDedupedSeeds,
  normalizeSeed,
  parseIdeationSeed,
} from './aiIdeation';

/**
 * TC-31 (pure core) — AI-ideation dedupe. The dedup key is `normalizedText`
 * (C7): `lowercase(collapseWhitespace(trim(NFKC(text))))`, the same key the
 * backend / cache / selection set use, so an appended keyword that only differs
 * by case / width / whitespace from an existing seed is treated as a duplicate.
 */

describe('TC-31 · normalizeSeed (C7 canonical key)', () => {
  it('lowercases, trims, and collapses internal whitespace', () => {
    expect(normalizeSeed('  Running   Shoes  ')).toBe('running shoes');
  });

  it('applies NFKC (fullwidth / compatibility folding) before casing', () => {
    // Fullwidth "ＲＵＮ" → "RUN" (NFKC) → "run" (lowercase).
    expect(normalizeSeed('ＲＵＮ')).toBe('run');
  });

  it('collapses tabs / newlines to a single space', () => {
    expect(normalizeSeed('trail\t\nshoes')).toBe('trail shoes');
  });
});

describe('TC-31 · appendDedupedSeeds', () => {
  it('appends only new keywords, de-duplicated against existing (case/space-insensitive)', () => {
    const merged = appendDedupedSeeds(
      ['running shoes'],
      ['trail shoes', 'Running Shoes', 'marathon'],
    );
    expect(merged).toEqual(['running shoes', 'trail shoes', 'marathon']);
  });

  it('preserves existing seeds verbatim and appends in generated order', () => {
    expect(appendDedupedSeeds(['A', 'B'], ['c', 'd'])).toEqual(['A', 'B', 'c', 'd']);
  });

  it('de-duplicates within the generated list too', () => {
    expect(appendDedupedSeeds([], ['run', 'RUN', 'trail'])).toEqual(['run', 'trail']);
  });

  it('drops empty / whitespace-only generated keywords', () => {
    expect(appendDedupedSeeds(['run'], ['', '   ', 'trail'])).toEqual(['run', 'trail']);
  });

  it('returns the existing list unchanged when nothing new is generated', () => {
    expect(appendDedupedSeeds(['run'], ['Run', ' RUN '])).toEqual(['run']);
  });
});

describe('TC-31 · AI_IDEATION_TEMPLATES', () => {
  it('offers exactly 10 templates with unique ids and non-empty labels', () => {
    expect(AI_IDEATION_TEMPLATES).toHaveLength(10);
    const ids = AI_IDEATION_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(10);
    for (const t of AI_IDEATION_TEMPLATES) expect(t.label.length).toBeGreaterThan(0);
  });
});

describe('TC-74 · v4 templates (backend FR-35 keys) + parseIdeationSeed', () => {
  it('the template ids are the v4 backend FR-35 keys, and labels carry a 「」 slot', () => {
    expect(AI_IDEATION_TEMPLATES.map((t) => t.id)).toEqual([
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
    for (const t of AI_IDEATION_TEMPLATES) expect(t.label).toContain('「」');
  });

  it('parseIdeationSeed extracts the trimmed 「」 content (empty when absent)', () => {
    expect(parseIdeationSeed('發想「吸塵器」的專業術語與技術規格')).toBe('吸塵器');
    expect(parseIdeationSeed('發想「 塵蟎機 」的延伸子主題')).toBe('塵蟎機');
    expect(parseIdeationSeed('發想「」的專業術語')).toBe('');
    expect(parseIdeationSeed('no slot here')).toBe('');
  });
});
