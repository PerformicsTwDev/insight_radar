import { expect, test } from '@playwright/test';

// Visual-regression PLACEHOLDER (T0.3) — see ./README.md and
// `.claude/rules/visual-regression.md`.
//
// One screenshot of the current boot-smoke shell so the visual runner is
// exercisable now. Real mockup-golden baselines land at M6/T6.3 from
// `docs/_p/uiux/*.html` (Search Insight v3/v4, keyword-tracking v2).
//
// Baselines live next to this file in `app.visual.spec.ts-snapshots/` and MUST
// be generated inside `mcr.microsoft.com/playwright:v1.61.1-noble` (linux +
// chromium) — never on macOS (cross-OS/arch AA flake). Real mockup-golden
// baselines land at M6/T6.3.
//
// PLACEHOLDER: marked `fixme` so the visual runner is exercisable now WITHOUT a
// standing red (no baseline exists yet, by design) — this keeps a future
// `frontend.yml` visual job green until M6 rather than red for M1–M5. T6.3
// un-fixmes this, generates the Docker baseline, and adds the real page shots.
test.fixme('app shell matches visual baseline (baseline lands at M6/T6.3)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await expect(page).toHaveScreenshot('app-shell.png');
});
