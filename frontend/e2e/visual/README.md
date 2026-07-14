# Visual regression baselines

Discipline SSOT: [`.claude/rules/visual-regression.md`](../../../.claude/rules/visual-regression.md).
Workflow SSOT: the `design-to-code` skill.

## Determinism: baselines are Linux + chromium only

Cross-OS / cross-arch font rendering and sub-pixel anti-aliasing are the biggest
flake source. Baselines (`*.spec.ts-snapshots/*.png`) are therefore generated
**and** verified in the **same pinned Docker image** — never on macOS, and never
on Apple-Silicon arm64 (CI runs amd64):

```
mcr.microsoft.com/playwright:v1.61.1-noble   # must equal the @playwright/test version
```

Regenerate baselines (from the repo root) with the image matching
`@playwright/test` in `frontend/package.json`, on the CI architecture (amd64):

```bash
docker run --rm --platform linux/amd64 --ipc=host \
  -v "$PWD":/work -w /work/frontend \
  mcr.microsoft.com/playwright:v1.61.1-noble \
  bash -lc 'corepack enable && corepack prepare pnpm@9.15.0 --activate \
            && pnpm install --frozen-lockfile \
            && pnpm e2e:update'
```

`pnpm e2e:update` = `playwright test --project=visual --update-snapshots`.
Commit the resulting `app.visual.spec.ts-snapshots/*.png`. Review PNG diffs in
the PR. Raising a threshold to turn red → green is cheap-shortcutting (rule §3) —
find the diff root cause first.

## Status at T0.3 (M0): placeholder harness only

`app.visual.spec.ts` screenshots the boot-smoke shell (`<h1>Insight Radar</h1>`)
purely so the visual runner is exercisable. It is marked **`test.fixme`** because
no baseline exists yet (by design — real baselines land at M6): `pnpm -C frontend
e2e:visual` runs and reports it **skipped**, so a future `frontend.yml` visual job
stays green through M1–M5 instead of a standing red. **T6.3 un-fixmes it**, which
re-activates the `toHaveScreenshot` assertion — at which point rule §2 applies:
a missing baseline is then a hard red and CI must not auto-generate one.

## Real baselines: M6 / T6.3

Real mockup-golden baselines are captured at **M6 / T6.3** from the mockup
sources in [`docs/_p/uiux/*.html`](../../../docs/_p/uiux/) — Search Insight
v3/v4 and keyword-tracking v2 — via the `design-to-code` screenshot flow.
