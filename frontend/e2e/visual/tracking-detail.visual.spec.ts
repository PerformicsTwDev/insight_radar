import { expect, test } from '@playwright/test';

// Visual-regression PLACEHOLDER (T5.6, TC-53) — see ./README.md and
// `.claude/rules/visual-regression.md`.
//
// TC-53 has TWO layers: the tracking-detail dashboard **logic/structure** (the
// `fetchedAt`-axis series assembly — aggregate `total` line + selected member lines
// with null breaks, C11; the empty "尚無時序資料" state that draws NO 0 line,
// AC-30.3; the member table's latest volume / sparkline / addedAt / guarded remove;
// the 6M/12M/all window) is fully covered NOW by vitest —
// `src/lib/volumeSeries.test.ts` and `src/features/tracking/TrackingDetailView.test.tsx`.
// The **pixel-golden** layer (this file) defers to M6/T6.3 per the SSOT baseline
// convention below — it is NOT a shortcut: real mockup-golden baselines can only be
// generated deterministically inside the pinned Docker image, which is stood up at M6.
//
// Baselines live next to this file in `tracking-detail.visual.spec.ts-snapshots/`
// and MUST be generated inside `mcr.microsoft.com/playwright:v1.61.1-noble` (linux +
// chromium) — never on macOS / arm64 (cross-OS/arch sub-pixel AA is the biggest flake
// source). A missing baseline is then a hard red (rule §2); CI must not auto-generate
// one.
//
// PLACEHOLDER: marked `fixme` so the visual runner stays exercisable now WITHOUT a
// standing red (no baseline exists yet, by design) — this keeps `frontend.yml`'s
// visual job green through M1–M5 rather than red. T6.3 un-fixmes this, generates the
// Docker baseline (the new-design tracking-detail golden, Issue #617), and wires the
// real route (the top-level tracking entry lands at T5.7 / nav routing at #443).
test.fixme('追蹤詳情時序 matches visual baseline (aggregate + member lines / member table; baseline lands at M6/T6.3)', async ({
  page,
}) => {
  await page.goto('/');
  // T6.3 drives the tracking detail view to its ready state and screenshots the chart
  // by its accessible name; the structural contract is already vitest-locked (TC-30).
  const chart = page.getByRole('img', { name: '搜量時序折線圖' });
  await expect(chart).toBeVisible();

  await expect(chart).toHaveScreenshot('tracking-detail.png');
});
