import {
  JOURNEY_STAGES,
  JOURNEY_STAGE_LABELS,
  isJourneyStage,
  journeyStageStep,
  type JourneyStage,
} from './journeyStages';

/**
 * Pure geometry + aggregation for the 購買歷程漏斗 (T4.5, FR-15; TC-51). **No React /
 * no IO** → core `src/lib/**` (≥90% gate). Ports the mockup `renderJourneyPipeline`
 * (jstage/jbar) maths so the funnel component stays a thin renderer: **柱高 ∝ 階段搜量
 * 對最大值歸一**, **趨勢 % = 階段間變化** (逐階段), reusing the {@link journeyStages}
 * SSOT for the enum↔zh label + 步驟號 (single point — no funnel-local mapping).
 *
 * **0-not-hidden (重構重點):** unlike the treemap (which drops null/≤0 cells), the
 * funnel is a *linear* 7-stage journey — {@link computeFunnelStages} therefore always
 * emits **all 7 stages** in order; a stage with 0 rows aggregates to `volume: 0`
 * (never null) and stays in the list so the funnel shows 0 rather than a gap. Null
 * `avgMonthlySearches` is skipped, never coerced to 0 (C12); rows whose `stage` is
 * not one of the 7 canonical stages are not funnel nodes and are excluded.
 */

/** One funnel node: a canonical journey stage with its aggregated volume + geometry. */
export interface FunnelStage {
  readonly stage: JourneyStage;
  /** 步驟號 1→7 (journeyStages ordinal — SSOT). */
  readonly step: number;
  /** 中文 label (journeyStages SSOT — no funnel-local mapping). */
  readonly label: string;
  /** 階段搜量加總 (sum of non-null avgMonthlySearches; 0 rows / all-null → 0, never null). */
  readonly volume: number;
  /** 柱高 % (0–100), ∝ volume normalized to the max stage volume (all-0 → 0). */
  readonly heightPct: number;
  /** 階段間變化 % vs the previous stage; null for the first stage / a 0 baseline. */
  readonly trendPct: number | null;
}

/** Trend chip display: signed magnitude behind a direction arrow + the up/down flag. */
export interface StageTrendDisplay {
  readonly text: string;
  readonly up: boolean;
}

/**
 * Sum each canonical stage's non-null, positive `avgMonthlySearches` from the journey
 * rows. Always returns all 7 stages (missing / empty → 0, never null — the resonance
 * with 0-not-hidden). Null / non-number volumes are skipped (C12, never coerced to 0);
 * rows whose `stage` is not one of the 7 canonical stages are excluded (not a node).
 */
export function aggregateStageVolumes(
  rows: readonly Record<string, unknown>[],
): Record<JourneyStage, number> {
  const totals = Object.fromEntries(JOURNEY_STAGES.map((stage) => [stage, 0])) as Record<
    JourneyStage,
    number
  >;
  for (const row of rows) {
    const stage = row.stage;
    if (!isJourneyStage(stage)) continue;
    const volume = row.avgMonthlySearches;
    if (typeof volume === 'number' && volume > 0) {
      totals[stage] += volume;
    }
  }
  return totals;
}

/**
 * 柱高 % (0–100), ∝ `volume` normalized to `maxVolume` (the tallest stage = 100%).
 * `maxVolume ≤ 0` (every stage empty) → 0 — no division by zero, no fabricated bars.
 */
export function barHeightPct(volume: number, maxVolume: number): number {
  if (maxVolume <= 0) return 0;
  return (volume / maxVolume) * 100;
}

/**
 * 階段間變化 %: `(current - previous) / previous * 100`. `previous ≤ 0` → null (no
 * baseline to compare against — division by zero; mirrors trend.ts `first === 0`).
 */
export function stageTrendPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Build the full 7-stage funnel from the journey rows (same source as `JourneyTable`).
 * Always all 7 stages, in canonical order, step 1→7 + zh label from the SSOT; each
 * bar height is normalized to the tallest stage and each trend is the change from the
 * previous stage (the first has none). 0-not-hidden: an empty stage stays at volume 0.
 */
export function computeFunnelStages(
  rows: readonly Record<string, unknown>[] | undefined,
): readonly FunnelStage[] {
  const volumes = aggregateStageVolumes(rows ?? []);
  const maxVolume = Math.max(...JOURNEY_STAGES.map((stage) => volumes[stage]));
  return JOURNEY_STAGES.map((stage, index) => {
    const volume = volumes[stage];
    const previous = index === 0 ? null : volumes[JOURNEY_STAGES[index - 1]];
    return {
      stage,
      step: journeyStageStep(stage),
      label: JOURNEY_STAGE_LABELS[stage],
      volume,
      heightPct: barHeightPct(volume, maxVolume),
      trendPct: previous === null ? null : stageTrendPct(volume, previous),
    };
  });
}

/**
 * Format a stage's trend % for display: the sign is absorbed into an ↑/↓ arrow
 * (≥ 0 → ↑ up, < 0 → ↓ down) with a 1-dp magnitude. `null` (first stage / 0 baseline)
 * → null so the renderer shows a neutral dash instead of a fabricated 0%.
 */
export function formatStageTrend(trendPct: number | null): StageTrendDisplay | null {
  if (trendPct === null) return null;
  const up = trendPct >= 0;
  return { text: `${up ? '↑' : '↓'} ${Math.abs(trendPct).toFixed(1)}%`, up };
}
