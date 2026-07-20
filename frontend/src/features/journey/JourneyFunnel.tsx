import type { ReactElement } from 'react';
import { EM_DASH, formatVolume } from '../../lib/keywordsTable';
import { computeFunnelStages, formatStageTrend } from '../../lib/journeyFunnel';
import { JOURNEY_STAGE_COLORS } from './journeyPalette';

/**
 * 購買歷程搜尋漏斗 (T4.5, FR-15; TC-51 結構). Self-made DOM funnel — jstage/jbar ported
 * from the mockup `renderJourneyPipeline`: **柱高 ∝ 階段搜量** (normalized to the max
 * stage, from the pure {@link computeFunnelStages}), **numbered nodes 1→7** on a
 * connecting path with chevrons, and a **stage-to-stage 趨勢 %** under each 中文 label.
 * Same data source as {@link JourneyTable} — the journey `rows` from
 * `POST /query {view:'journey'}` (`Record<string, unknown>[]`), values defensively
 * coerced in the lib. THIN component: every transform lives in `lib/journeyFunnel`.
 *
 * **0-not-hidden (重構重點):** the funnel is a linear 7-stage journey, so all 7 stages
 * always render (in order) — a stage with 0 keywords shows `formatVolume(0)` = "0"
 * with a floored bar, never a gap. Trend `null` (first stage / 0 baseline) → a neutral
 * dash, not a fabricated 0%. The decorative per-stage colour is the only inline hex
 * (one module, {@link JOURNEY_STAGE_COLORS}) — otherwise tokens only.
 */
export function JourneyFunnel({
  rows,
}: {
  rows: readonly Record<string, unknown>[] | undefined;
}): ReactElement {
  const stages = computeFunnelStages(rows);
  const lastIndex = stages.length - 1;

  return (
    <div className="overflow-x-auto rounded-xl bg-bg-card p-4 ring-1 ring-white/10">
      <div
        role="img"
        aria-label="購買歷程搜尋漏斗"
        className="flex min-w-[640px] items-end gap-0 pt-6"
      >
        {stages.map((stage, index) => {
          const color = JOURNEY_STAGE_COLORS[stage.stage];
          const trend = formatStageTrend(stage.trendPct);
          const value = formatVolume(stage.volume);
          return (
            <div
              key={stage.stage}
              data-testid="jstage"
              className="relative flex flex-1 flex-col items-center"
            >
              {/* jtrack — fixed height, bars grow up from the baseline. */}
              <div className="flex h-32 w-full items-end justify-center">
                <div
                  data-testid="jbar"
                  data-height-pct={stage.heightPct}
                  title={`${stage.label}：${value} 搜尋量`}
                  style={{ height: `${stage.heightPct}%`, backgroundColor: color }}
                  className="relative min-h-[8px] w-[58%] rounded-t-md shadow-[inset_0_-3px_0_rgba(0,0,0,0.12)]"
                >
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-xs font-semibold text-white/85">
                    {value}
                  </span>
                </div>
              </div>

              {/* jpath — connecting baseline with the numbered node + chevron seam. */}
              <div className="relative h-0 w-full border-t-2 border-dashed border-white/10">
                <div
                  data-testid="jnode"
                  style={{ backgroundColor: color }}
                  className="absolute -top-3.5 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-bg-card text-xs font-extrabold text-white"
                >
                  {stage.step}
                </div>
                {index < lastIndex ? (
                  <span
                    aria-hidden="true"
                    className="absolute -top-3 -right-1.5 text-lg leading-none text-white/25"
                  >
                    ›
                  </span>
                ) : null}
              </div>

              {/* jfoot — zh label + stage-to-stage trend %. */}
              <div className="pt-6 text-center">
                <div className="text-xs font-bold text-white/90">{stage.label}</div>
                <div
                  data-testid="jtrend"
                  className={
                    trend === null
                      ? 'mt-1 text-[11px] text-white/30'
                      : trend.up
                        ? 'mt-1 text-[11px] font-semibold text-brand'
                        : 'mt-1 text-[11px] font-semibold text-white/45'
                  }
                >
                  {trend === null ? EM_DASH : trend.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
