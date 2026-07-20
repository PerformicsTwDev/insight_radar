import type { JourneyStage } from '../../lib/journeyStages';

/**
 * Journey funnel stage colours (T4.5, FR-15) — the SINGLE place the 7-stage bar/node
 * palette is defined (no scattered hex, Design §3 tokens rule). Like `treemapPalette`
 * / `trendPalette`, a bar's `background` comes from a **runtime** stage→colour lookup
 * the Tailwind JIT can't safelist, so these literal values live in one module and are
 * applied inline. Keyed by the {@link JourneyStage} enum (not by index) so the palette
 * can't drift out of alignment with the 7-stage order.
 *
 * The ramp is **decorative** (a cool→warm walk down the linear journey, ported from
 * the mockup `chartData.stages` colours) — no semantic meaning, unlike intentMap's C2
 * colours. The 4th stage (規格比較) is absent from the mockup sample, so its colour is
 * interpolated into the ramp between 方案探索 and 口碑驗證.
 */
export const JOURNEY_STAGE_COLORS: Readonly<Record<JourneyStage, string>> = {
  pain_awareness: '#b79ced',
  need_definition: '#8e9be8',
  solution_exploration: '#6fa8dc',
  spec_comparison: '#5bb8c9',
  reputation_validation: '#52b788',
  final_decision: '#74c69d',
  repurchase_retention: '#f4c764',
};
