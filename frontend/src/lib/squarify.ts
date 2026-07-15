/**
 * Pure squarify treemap layout (T3.4, FR-8) — red stub (not yet implemented).
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

export function squarify(_items: readonly TreemapItem[], _width: number, _height: number): Rect[] {
  return [];
}
