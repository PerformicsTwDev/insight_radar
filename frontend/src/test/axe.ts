import { configureAxe } from 'vitest-axe';

/**
 * Shared axe runner for the a11y gate (NFR-7 / TC-24). Scoped to the WCAG 2.0/2.1
 * **A + AA** conformance tags — the exact NFR-7 target ("暗色對比 WCAG AA、互動元件
 * aria + axe 無 violation"). Scoping to WCAG tags deliberately drops axe's
 * *best-practice* rules (notably `region`, which flags any content not wrapped in a
 * landmark) so that rendering a single component in isolation — rather than a full
 * page with `<main>` landmarks — does not raise false positives.
 *
 * Usage: `expect(await axe(container)).toHaveNoViolations()` (matcher registered in
 * `./setup`). `color-contrast` (a WCAG AA rule) cannot compute in jsdom and reports
 * `incomplete` (never a `violation`); real token contrast is gated separately by the
 * `lib/contrast` audit (`src/test/themeA11y.test.ts`).
 */
export const axe = configureAxe({
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  },
  rules: {
    // `color-contrast` needs a canvas to sample rendered pixels; jsdom has none, so
    // axe can only ever report it `incomplete` (and spams a canvas warning). Real
    // token contrast is gated by the `lib/contrast` audit — disable it here.
    'color-contrast': { enabled: false },
  },
});
