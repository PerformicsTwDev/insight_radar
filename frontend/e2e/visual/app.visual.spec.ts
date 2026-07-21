import { expect, test } from '@playwright/test';
import { stubFullViews } from './support';

// Visual regression — TC-52 (NFR-6, FR-2/14): the 首頁 create-analysis form.
// See ./README.md and `.claude/rules/visual-regression.md`.
//
// The app root `/` (no `analysisId`) renders the create-analysis form (HomeRoute) —
// the app-shell landing golden. `/views` is stubbed so the dimension menu resolves
// (no degraded notice); the form itself is static (no async / no timestamp), so the
// `關鍵字分析` region is a deterministic screenshot target.
//
// Baselines live next to this file in `app.visual.spec.ts-snapshots/` and are
// generated + verified ONLY inside `mcr.microsoft.com/playwright:v1.61.1-noble`
// (linux + chromium) — never on macOS / arm64 (cross-OS/arch sub-pixel AA is the
// biggest flake source). A missing baseline is a hard red (rule §2); CI must not
// auto-generate one — they are produced by the `visual-baseline.yml` workflow.
test('首頁 create-analysis form matches visual baseline (TC-52)', async ({ page }) => {
  await stubFullViews(page);

  await page.goto('/');

  // The create form + AI-ideation card region (URL has no analysis → HomeRoute form).
  const home = page.getByRole('region', { name: '關鍵字分析' });
  await expect(home.getByRole('form', { name: '建立分析' })).toBeVisible();

  await expect(home).toHaveScreenshot('home-create-form.png');
});
