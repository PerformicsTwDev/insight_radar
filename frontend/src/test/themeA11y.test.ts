import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AA_NORMAL, compositeOver, contrastRatio, meetsAA, parseHex } from '../lib/contrast';
import { intentMap } from '../lib/intentMap';

/**
 * TC-24 (NFR-7) — dark-theme token contrast audit + visible focus ring, read from
 * the ONE source of truth (`src/index.css` `@theme`). axe cannot compute
 * `color-contrast` in jsdom (no canvas), so this is where the WCAG AA obligation
 * ("暗色對比 WCAG AA") is actually enforced: every semantic/brand colour used as
 * text, every interactive-control surface, and the shared muted-text tier are rated
 * against the background they render on. The pervasive `white/40–50` decorative /
 * secondary hint tiers (counts, timestamps, placeholders) are the mockup's
 * intentional hierarchy (Design §2) and are out of scope here.
 */

const CSS = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

/** Extract the `@theme { --color-x: #hex; ... }` tokens as a name→hex map. */
function themeTokens(): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--color-([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS)) !== null) out[m[1]] = m[2];
  return out;
}

const T = themeTokens();
/** Same-colour comparison that ignores hex case (`#9b5de5` === `#9B5DE5`). */
const sameHex = (a: string, b: string) => parseHex(a).join() === parseHex(b).join();

describe('TC-24 · dark-theme token contrast (WCAG AA)', () => {
  it('exposes the background scale + brand + danger surface tokens', () => {
    for (const name of ['bg-body', 'bg-card', 'bg-input', 'bg-raised', 'brand', 'danger']) {
      expect(T[name], `missing --color-${name}`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });

  it('keeps the intent tokens in @theme byte-equal (case-insensitive) to intentMap (C2)', () => {
    for (const [key, meta] of Object.entries(intentMap)) {
      expect(sameHex(T[`intent-${key}`], meta.color), `intent-${key} drift`).toBe(true);
    }
  });

  it('rates every intent chip colour AA on bg-card (chip text, 4.5:1)', () => {
    for (const [key, meta] of Object.entries(intentMap)) {
      const ratio = contrastRatio(meta.color, T['bg-card']);
      expect(meetsAA(ratio), `intent ${key} = ${ratio.toFixed(2)}:1 on bg-card`).toBe(true);
    }
  });

  it('rates every semantic status/accent text colour AA on bg-card (4.5:1)', () => {
    for (const name of [
      'brand',
      'warn',
      'trend-negative',
      'trend-surge',
      'intent-informational',
      'intent-commercial',
      'intent-transactional',
    ]) {
      const ratio = contrastRatio(T[name], T['bg-card']);
      expect(meetsAA(ratio), `${name} = ${ratio.toFixed(2)}:1 on bg-card`).toBe(true);
    }
  });

  it('rates the primary brand button (bg-body text on brand) AA (4.5:1)', () => {
    const ratio = contrastRatio(T['bg-body'], T['brand']);
    expect(meetsAA(ratio), `brand button = ${ratio.toFixed(2)}:1`).toBe(true);
  });

  it('rates the destructive button (white text on the danger surface) AA (4.5:1)', () => {
    const ratio = contrastRatio('#ffffff', T['danger']);
    expect(meetsAA(ratio), `danger button = ${ratio.toFixed(2)}:1`).toBe(true);
  });

  it('rates the shared secondary-text tier (white/60) AA on every background', () => {
    for (const bg of ['bg-body', 'bg-card', 'bg-input', 'bg-raised']) {
      const resolved = compositeOver('#ffffff', 0.6, T[bg]);
      const ratio = contrastRatio(resolved, T[bg]);
      expect(ratio, `white/60 on ${bg}`).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
});

describe('TC-24 · visible focus ring (focus-visible)', () => {
  it('defines a keyboard focus-visible outline in the brand colour', () => {
    // Single source of the visible ring: a `:focus-visible` rule carrying an
    // `outline` in the brand token, so every interactive control shows a ring on
    // keyboard focus (dark-theme visible). jsdom cannot paint it, so we guard the
    // rule's presence in the token SSOT.
    const block = CSS.match(/:focus-visible[^{]*\{[^}]*\}/g)?.join('\n') ?? '';
    expect(block, 'no :focus-visible rule in index.css').not.toBe('');
    expect(block).toMatch(/outline/);
    expect(/var\(--color-brand\)/.test(block) || sameHex4(block)).toBe(true);
  });
});

/** True when the focus-visible block hard-codes the brand hex (fallback to var()). */
function sameHex4(block: string): boolean {
  const hex = block.match(/#[0-9a-fA-F]{3,8}/)?.[0];
  return hex !== undefined && sameHex(hex, T['brand']);
}
