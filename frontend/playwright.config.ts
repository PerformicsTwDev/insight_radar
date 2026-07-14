import { defineConfig, devices } from '@playwright/test';

// Playwright e2e + visual-regression harness (T0.3).
//
// Visual-regression discipline — see `.claude/rules/visual-regression.md`:
//   • Baselines are generated ONLY in the pinned Docker image
//     `mcr.microsoft.com/playwright:v1.61.1-noble` (linux + chromium), NEVER on
//     macOS — cross-OS/arch sub-pixel AA is the biggest flake source. A macOS (or
//     arm64) baseline would flake against the amd64 Linux CI.
//   • chromium ONLY; the `visual` project runs serially (single worker below).
//   • Real mockup-golden baselines land at M6/T6.3 from `docs/_p/uiux/*.html`
//     (Search Insight v3/v4, keyword-tracking v2) — NOT here. This harness only
//     screenshots the current boot-smoke shell as a placeholder.
const PORT = 4173;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Deterministic ordering; the visual project must run serially (rule §7).
  fullyParallel: false,
  workers: 1,
  // Baselines are NEVER auto-written by a plain run — a missing baseline is a
  // hard red (rule §2: "CI 缺基準即紅", CI must not auto-generate). The
  // `--update-snapshots` CLI flag in `e2e:update` overrides this to (re)generate,
  // and that MUST be run inside the pinned Docker image (see header + e2e/visual/README.md).
  updateSnapshots: 'none',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  // rule §3/§5: 1% global pixel-ratio tolerance; freeze animations + caret.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'e2e',
      testMatch: '**/*.spec.ts',
      testIgnore: '**/*.visual.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'visual',
      testMatch: '**/*.visual.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Preview the production build (more deterministic than the dev server).
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
