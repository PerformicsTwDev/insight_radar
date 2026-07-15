/**
 * Pure squarify treemap layout (T3.4, FR-8) — the classic Bruls/Huizing/van Wijk
 * algorithm. It greedily packs items into a strip along the shorter side of the
 * remaining rectangle, growing the strip while that keeps (or lowers) its worst
 * aspect ratio, so every cell's **area is proportional to its value** — the treemap
 * invariant. **No React, no IO** (core ≥90): a pure layout is unit-testable ("area ∝
 * clusterVolume") and needs no canvas (jsdom has none) — the component renders the
 * returned rects as percentage-positioned `<div>`s (Design §2, T3.4 decision).
 *
 * Contract: callers pass positive values — T3.4 excludes null/≤0 clusterVolume
 * upstream (C12: a missing volume must never be fabricated into an area). Defensive
 * on the boundary: a non-positive value is **skipped** (no rect emitted), so the
 * output holds one rect per positive item, in input order; a non-positive
 * width/height, or an input with no positive value, yields `[]`.
 */

export interface TreemapItem {
  readonly value: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Bruls "worst" aspect ratio of a row of `areas` laid along a side of length `side`:
 * `max( side²·max / sum², sum²/(side²·min) )`. Lower is squarer; never called with an
 * empty row (the first item always joins unconditionally).
 */
function worstRatio(areas: readonly number[], side: number): number {
  const sum = areas.reduce((acc, area) => acc + area, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const side2 = side * side;
  const sum2 = sum * sum;
  return Math.max((side2 * max) / sum2, sum2 / (side2 * min));
}

export function squarify(items: readonly TreemapItem[], width: number, height: number): Rect[] {
  if (width <= 0 || height <= 0) {
    return [];
  }
  const values = items.map((item) => item.value).filter((value) => value > 0);
  if (values.length === 0) {
    return [];
  }

  const total = values.reduce((acc, value) => acc + value, 0);
  // Scale each value into an area so the strips exactly tile width×height.
  const areas = values.map((value) => (value / total) * (width * height));

  const rects: Rect[] = [];
  let x = 0;
  let y = 0;
  let freeWidth = width;
  let freeHeight = height;
  let index = 0;

  while (index < areas.length) {
    const side = Math.min(freeWidth, freeHeight);
    // Grow the current strip while it keeps (or improves) the worst aspect ratio.
    let row: number[] = [];
    while (index < areas.length) {
      const candidate = [...row, areas[index]];
      if (row.length === 0 || worstRatio(candidate, side) <= worstRatio(row, side)) {
        row = candidate;
        index++;
      } else {
        break;
      }
    }

    const rowSum = row.reduce((acc, area) => acc + area, 0);
    const thickness = rowSum / side;
    let offset = 0;
    if (freeWidth >= freeHeight) {
      // Left-hand column (width = thickness); cells stacked top→down.
      for (const area of row) {
        const cellHeight = area / thickness;
        rects.push({ x, y: y + offset, width: thickness, height: cellHeight });
        offset += cellHeight;
      }
      x += thickness;
      freeWidth -= thickness;
    } else {
      // Top strip (height = thickness); cells stacked left→right.
      for (const area of row) {
        const cellWidth = area / thickness;
        rects.push({ x: x + offset, y, width: cellWidth, height: thickness });
        offset += cellWidth;
      }
      y += thickness;
      freeHeight -= thickness;
    }
  }

  return rects;
}
