# Visual regression baselines

Discipline SSOT: [`.claude/rules/visual-regression.md`](../../../.claude/rules/visual-regression.md).
Workflow SSOT: the `design-to-code` skill.

## Determinism: baselines are Linux + chromium only, generated in CI

Cross-OS / cross-arch font rendering and sub-pixel anti-aliasing are the biggest
flake source. Baselines (`*.visual.spec.ts-snapshots/*.png`) are therefore generated
**and** verified in the **same pinned Docker image** — never on macOS, and never
on Apple-Silicon arm64 (CI runs amd64):

```
mcr.microsoft.com/playwright:v1.61.1-noble   # must equal the @playwright/test version
```

### Generating baselines: the `visual-baseline.yml` workflow (not local Docker)

The dev machine has **no Docker daemon**, so baselines are generated **in CI** by a
manually-dispatched workflow that runs `pnpm e2e:update` inside the pinned image and
commits the PNGs back to the triggering branch:

```bash
# From the branch that needs baselines (e.g. the T6.3 PR branch):
gh workflow run visual-baseline.yml --ref <branch>
# → runs playwright test --project=visual --update-snapshots in v1.61.1-noble,
#   then commits `test(frontend): generate visual regression baselines (T6.3)` + pushes.
```

`pnpm e2e:update` = `playwright test --project=visual --update-snapshots`. Review the
committed PNG diffs in the PR. Raising a threshold to turn red → green is
cheap-shortcutting (rule §3) — find the diff root cause first.

> **After generation, re-run the visual check.** The workflow pushes with the default
> `GITHUB_TOKEN`, whose commits **do not** re-trigger workflows (loop guard). So
> `frontend.yml`'s `e2e` job does not auto-rerun on the baseline commit — re-run that
> check on the PR (`gh run rerun <run-id> --failed`, or push an empty commit) to see it
> go green against the new baselines.

If push-back is blocked (Free-plan token / `contents: write` restrictions), the run
fails at the push step — regenerate locally is **not** an option (no Docker / wrong
arch); escalate the token/permission fix instead of committing an arm64 baseline.

### Verifying baselines in CI: `frontend.yml` → `e2e` job

`frontend.yml`'s **`e2e`** job runs the same pinned image and executes both
`pnpm e2e` (the `e2e` project, TC-43 to TC-48) and `pnpm e2e:visual` (the `visual`
project, TC-49 to TC-54). A **missing baseline is a hard red** (rule §2) — CI never
auto-generates one; that is exclusively `visual-baseline.yml`'s job.

## Baselines (T6.3 / M6): the seven view goldens (TC-49~54)

Real mockup-golden baselines are captured at **M6 / T6.3** from the design mockups
([`docs/_p/uiux/*.html`](../../../docs/_p/uiux/) — Search Insight v3/v4 and
keyword-tracking v2). Each spec navigates a **routed** view (`/?analysisId=…&view=…`
or `/tracking/$listId`), drives it to its ready state with the **T6.4 route-stub
helpers** (`../support/stubs.ts` + `./support.ts`), and screenshots one **stable,
dynamic-region-free element** (no timestamps in-frame; `animations:'disabled'` +
`caret:'hide'` are global in `playwright.config.ts`):

| TC    | Spec                             | View / route                             | Golden                                 | Scope                   | Tolerance |
| ----- | -------------------------------- | ---------------------------------------- | -------------------------------------- | ----------------------- | --------- |
| TC-52 | `app.visual.spec.ts`             | `/` (home)                               | `home-create-form.png`                 | `關鍵字分析` region     | 0.01      |
| TC-49 | `keywords.visual.spec.ts`        | `?view=keywords`                         | `keywords-table.png`                   | `搜尋詞總表` table      | 0.01      |
| TC-49 | `trend.visual.spec.ts`           | `?view=trend`                            | `trend-chart.png`                      | `搜尋趨勢折線圖` canvas | 0.05      |
| TC-50 | `intent-topics.visual.spec.ts`   | `?view=intent_topics` → 圖表             | `intent-treemap.png`                   | `意圖佔比樹狀圖`        | 0.05      |
| TC-51 | `journey-funnel.visual.spec.ts`  | `?view=journey_funnel`                   | `journey-funnel.png`                   | `購買歷程搜尋漏斗`      | 0.05      |
| TC-53 | `tracking-detail.visual.spec.ts` | `/tracking/$listId`                      | `tracking-detail.png`                  | `搜量時序折線圖` canvas | 0.05      |
| TC-54 | `filters-gate.visual.spec.ts`    | `?view=keywords` / `?view=intent_topics` | `filter-chips.png`, `feature-gate.png` | `篩選` group / `main`   | 0.01      |

The 圖表-class 0.05 tolerance (rule §3) applies to the Chart.js `<canvas>` charts
(trend, tracking) and the data-viz DOM funnel / treemap; crisp DOM tables / forms /
chips keep the global 0.01. Chart.js animation is left to Playwright's screenshot
stabilization (it retries until two consecutive frames match).
