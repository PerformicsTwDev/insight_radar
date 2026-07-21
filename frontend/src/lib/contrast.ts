/**
 * WCAG 2.x contrast primitives (NFR-7 / TC-24). Pure colour math used by the
 * dark-theme token audit to rate every semantic/brand colour and interactive
 * surface against the background it renders on. No DOM — axe cannot compute
 * `color-contrast` in jsdom, so contrast conformance is proven here instead.
 */
export type Rgb = readonly [number, number, number];

/** WCAG AA minimum for normal text. */
export const AA_NORMAL = 4.5;
/** WCAG AA minimum for large text (≥18.66px bold / 24px) and UI components. */
export const AA_LARGE = 3;

/** Parse `#rgb` / `#rrggbb` (hash + case optional) to an RGB triple. */
export function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`invalid hex colour: ${hex}`);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toRgb(c: Rgb | string): Rgb {
  return typeof c === 'string' ? parseHex(c) : c;
}

/** Linearize one 0–255 sRGB channel (WCAG relative-luminance step). */
function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb;
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG 2.x contrast ratio (1–21), order-independent. Accepts hex or RGB. */
export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const la = relativeLuminance(toRgb(a));
  const lb = relativeLuminance(toRgb(b));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Straight-alpha composite of a (possibly translucent) foreground over an opaque
 * background — resolves a `white/xx` text tier to the opaque colour it actually
 * paints as, so it can be rated.
 */
export function compositeOver(fg: Rgb | string, alpha: number, bg: Rgb | string): Rgb {
  const f = toRgb(fg);
  const b = toRgb(bg);
  return [
    alpha * f[0] + (1 - alpha) * b[0],
    alpha * f[1] + (1 - alpha) * b[1],
    alpha * f[2] + (1 - alpha) * b[2],
  ];
}

/** True when `ratio` clears the AA bar (normal 4.5:1, or large/UI 3:1). */
export function meetsAA(ratio: number, opts?: { large?: boolean }): boolean {
  return ratio >= (opts?.large ? AA_LARGE : AA_NORMAL);
}
