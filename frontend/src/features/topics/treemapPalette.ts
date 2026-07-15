/**
 * Treemap green ramp (T3.4, FR-8) — the SINGLE place the 8-shade treemap palette is
 * defined (no scattered hex, Design §3 tokens rule). Unlike a Tailwind utility class
 * or `var(--color-*)`, a treemap cell's `background` comes from a **runtime**
 * rank→shade lookup the JIT can't safelist, so — like `trendPalette` (canvas colours)
 * — these are literal values kept in one module and applied inline.
 *
 * The ramp fans out from the brand greens (`--color-brand` #52b788 /
 * `--color-brand-dark` #40916c, index.css @theme) into deeper and lighter greens.
 * It is **decorative** (rank order, no semantic meaning — unlike intentMap's C2
 * colours): the biggest cluster takes the first (deepest) shade, cycling if there
 * are more than 8 clusters.
 */
export const TM_SHADES: readonly string[] = [
  '#1b4332',
  '#2d6a4f',
  '#40916c', // --color-brand-dark
  '#52b788', // --color-brand
  '#74c69d',
  '#95d5b2',
  '#2f5d62',
  '#3a7d8c',
];

/** Pick a shade by rank (0 = largest cluster → deepest shade), cycling past the 8th. */
export function pickShade(index: number): string {
  return TM_SHADES[index % TM_SHADES.length];
}
