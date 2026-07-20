import { expect, test } from '@playwright/test';

// Visual-regression PLACEHOLDER (T4.5, TC-51) — see ./README.md and
// `.claude/rules/visual-regression.md`.
//
// TC-51 has TWO layers: the funnel **logic/structure** (bar height ∝ stage volume
// normalized to the max, numbered nodes 1→7, stage-to-stage trend %, 0-not-hidden,
// enum↔zh reuse) is fully covered NOW by vitest — `src/lib/journeyFunnel.test.ts`
// and `src/features/journey/JourneyFunnel.test.tsx`. The **pixel-golden** layer
// (this file) defers to M6/T6.3 per the SSOT baseline convention below — it is NOT
// a shortcut: real mockup-golden baselines can only be generated deterministically
// inside the pinned Docker image, which is stood up at M6.
//
// Baselines live next to this file in `journey-funnel.visual.spec.ts-snapshots/`
// and MUST be generated inside `mcr.microsoft.com/playwright:v1.61.1-noble` (linux
// + chromium) — never on macOS / arm64 (cross-OS/arch sub-pixel AA is the biggest
// flake source). A missing baseline is then a hard red (rule §2); CI must not
// auto-generate one.
//
// PLACEHOLDER: marked `fixme` so the visual runner stays exercisable now WITHOUT a
// standing red (no baseline exists yet, by design) — this keeps `frontend.yml`'s
// visual job green through M1–M5 rather than red. T6.3 un-fixmes this, generates the
// Docker baseline from `docs/_p/uiux/*.html` (jstage/jbar), and wires the real route.
test.fixme('購買歷程漏斗 matches visual baseline (bar height / nodes 1→7 / trend %; baseline lands at M6/T6.3)', async ({
  page,
}) => {
  await page.goto('/');
  // T6.3 drives the journey view to its ready state and screenshots the funnel by
  // its accessible name; the structural contract is already vitest-locked (TC-51).
  const funnel = page.getByRole('img', { name: '購買歷程搜尋漏斗' });
  await expect(funnel).toBeVisible();

  await expect(funnel).toHaveScreenshot('journey-funnel.png');
});
