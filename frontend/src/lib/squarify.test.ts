import { describe, it, expect } from 'vitest';
import { squarify, type Rect, type TreemapItem } from './squarify';

/**
 * TC-19 (圖表) — pure squarify treemap layout (T3.4, FR-8). Invariants: (a) each
 * rect's area is proportional to its value; (b) the rects together cover the whole
 * container; (c) rects stay in-bounds and never overlap; (d) a single item fills the
 * container; (e) empty input → []. Plus the C12-driven contract: a non-positive
 * value is skipped (no fabricated area), never sized into a rect.
 */

const EPS = 1e-6;

const areaOf = (rect: Rect): number => rect.width * rect.height;
const totalArea = (rects: readonly Rect[]): number => rects.reduce((s, r) => s + areaOf(r), 0);

/** Two rects overlap iff neither lies fully to a side of the other (with a float slack). */
function overlaps(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width <= b.x + EPS ||
    b.x + b.width <= a.x + EPS ||
    a.y + a.height <= b.y + EPS ||
    b.y + b.height <= a.y + EPS
  );
}

describe('TC-19 · squarify (treemap layout, area ∝ value)', () => {
  it('(a) makes each rect area proportional to its value, in input order', () => {
    const items: TreemapItem[] = [{ value: 3 }, { value: 2 }, { value: 1 }];
    const rects = squarify(items, 6, 4);
    expect(rects).toHaveLength(3);
    const scale = (6 * 4) / (3 + 2 + 1);
    rects.forEach((rect, i) => {
      expect(areaOf(rect)).toBeCloseTo(items[i].value * scale, 6);
    });
    // pairwise ratio: the 3-value rect is 3× the 1-value rect
    expect(areaOf(rects[0]) / areaOf(rects[2])).toBeCloseTo(3, 6);
  });

  it('(b) covers the whole container area', () => {
    const rects = squarify([{ value: 3 }, { value: 2 }, { value: 1 }], 6, 4);
    expect(totalArea(rects)).toBeCloseTo(24, 6);
  });

  it('(c) keeps every rect in-bounds and non-overlapping', () => {
    const rects = squarify([{ value: 5 }, { value: 3 }, { value: 2 }, { value: 1 }], 10, 7);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(-EPS);
      expect(rect.y).toBeGreaterThanOrEqual(-EPS);
      expect(rect.x + rect.width).toBeLessThanOrEqual(10 + EPS);
      expect(rect.y + rect.height).toBeLessThanOrEqual(7 + EPS);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j])).toBe(false);
      }
    }
  });

  it('(d) fills the whole container with a single item', () => {
    expect(squarify([{ value: 5 }], 10, 8)).toEqual([{ x: 0, y: 0, width: 10, height: 8 }]);
  });

  it('(e) returns [] for empty input', () => {
    expect(squarify([], 10, 8)).toEqual([]);
  });

  it('covers both strip orientations for equal-value items in a square container', () => {
    const rects = squarify([{ value: 1 }, { value: 1 }, { value: 1 }, { value: 1 }], 2, 2);
    expect(rects).toHaveLength(4);
    expect(totalArea(rects)).toBeCloseTo(4, 6);
    for (const rect of rects) {
      expect(areaOf(rect)).toBeCloseTo(1, 6);
    }
  });

  it('skips a zero-value item without fabricating area for it (C12 contract)', () => {
    // Only the positive item is sized; the 0 gets no rect (area is never invented).
    expect(squarify([{ value: 0 }, { value: 4 }], 10, 8)).toEqual([
      { x: 0, y: 0, width: 10, height: 8 },
    ]);
  });

  it('returns [] when no value is positive (all zero/negative)', () => {
    expect(squarify([{ value: -3 }, { value: 0 }], 10, 8)).toEqual([]);
  });

  it('returns [] for a non-positive width', () => {
    expect(squarify([{ value: 1 }], 0, 8)).toEqual([]);
  });

  it('returns [] for a non-positive height', () => {
    expect(squarify([{ value: 1 }], 10, 0)).toEqual([]);
  });
});
