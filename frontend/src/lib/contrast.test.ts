import { describe, expect, it } from 'vitest';
import {
  AA_LARGE,
  AA_NORMAL,
  compositeOver,
  contrastRatio,
  meetsAA,
  parseHex,
  relativeLuminance,
} from './contrast';

/**
 * TC-24 (NFR-7) — WCAG contrast primitives. Pure math the dark-theme token audit
 * (`src/test/themeA11y.test.ts`) builds on: relative luminance + the 2.0 contrast
 * ratio, plus straight-alpha compositing so a translucent `white/xx` text tier can
 * be resolved to an opaque colour before it is rated.
 */
describe('TC-24 · contrast primitives', () => {
  it('parses #hex (with or without the hash, any case) to an RGB triple', () => {
    expect(parseHex('#52b788')).toEqual([0x52, 0xb7, 0x88]);
    expect(parseHex('52B788')).toEqual([0x52, 0xb7, 0x88]);
    expect(parseHex('#FFFFFF')).toEqual([255, 255, 255]);
    expect(parseHex('#000000')).toEqual([0, 0, 0]);
  });

  it('expands 3-digit shorthand hex', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#000')).toEqual([0, 0, 0]);
  });

  it('rejects a malformed hex', () => {
    expect(() => parseHex('#12')).toThrow();
    expect(() => parseHex('nope')).toThrow();
  });

  it('computes relative luminance at the sRGB extremes', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
  });

  it('rates black-on-white at the canonical 21:1 and identical colours at 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is symmetric regardless of argument order', () => {
    const a = contrastRatio('#52b788', '#2c2c2c');
    const b = contrastRatio('#2c2c2c', '#52b788');
    expect(a).toBeCloseTo(b, 10);
  });

  it('accepts RGB triples as well as hex strings', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
  });

  it('alpha-composites a translucent foreground over a background', () => {
    // alpha 1 → the foreground; alpha 0 → the background; 0.5 → the midpoint.
    expect(compositeOver('#ffffff', 1, '#222222')).toEqual([255, 255, 255]);
    expect(compositeOver('#ffffff', 0, '#222222')).toEqual([0x22, 0x22, 0x22]);
    expect(compositeOver([255, 255, 255], 0.5, [0, 0, 0])).toEqual([127.5, 127.5, 127.5]);
  });

  it('rates AA against the normal (4.5) and large/UI (3.0) thresholds', () => {
    expect(AA_NORMAL).toBe(4.5);
    expect(AA_LARGE).toBe(3);
    expect(meetsAA(4.5)).toBe(true);
    expect(meetsAA(4.49)).toBe(false);
    expect(meetsAA(3.0, { large: true })).toBe(true);
    expect(meetsAA(2.99, { large: true })).toBe(false);
    expect(meetsAA(3.0)).toBe(false); // 3.0 fails the normal-text bar
  });
});
