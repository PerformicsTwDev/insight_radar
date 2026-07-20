import { describe, expect, it } from 'vitest';
import {
  aggregateStageVolumes,
  barHeightPct,
  computeFunnelStages,
  formatStageTrend,
  stageTrendPct,
} from './journeyFunnel';
import { JOURNEY_STAGES } from './journeyStages';

/**
 * TC-51 (FR-15, 漏斗**邏輯**) — 購買歷程漏斗的純幾何/聚合單點（core ≥90 gate；no React/IO）。
 * 對齊 mockup `renderJourneyPipeline`（jstage/jbar 移植）：**柱高 ∝ 階段搜量對最大值歸一**、
 * **趨勢 % = 階段間變化**（逐階段），並複用 `journeyStages` SSOT 的 enum↔zh + 步驟號單點。
 * **某階段 0 列 → 顯 0 不隱藏**：漏斗恆輸出全 7 階段，空階段 volume=0（never null），仍在列。
 * 逐值真測比例/趨勢（不臆造），null 搜量不補 0（C12）、未分類階段不入漏斗節點。
 */

/** Journey row as delivered by `POST /query {view:'journey'}` (untyped cells, C12). */
const row = (stage: string, avgMonthlySearches: number | null) => ({
  text: `kw-${stage}`,
  stage,
  avgMonthlySearches,
});

describe('TC-51 · aggregateStageVolumes (階段搜量加總；null 不補 0、未分類不入漏斗)', () => {
  it('sums non-null avgMonthlySearches per canonical stage; always emits all 7 keys', () => {
    const totals = aggregateStageVolumes([
      row('pain_awareness', 100),
      row('pain_awareness', 50),
      row('need_definition', null), // C12: null 搜量跳過、不補 0
      row('solution_exploration', 200),
    ]);
    // 全 7 階段皆為 key（0-not-hidden 的資料層保證），空階段 = 0（never null）。
    expect(Object.keys(totals).sort()).toEqual([...JOURNEY_STAGES].sort());
    expect(totals.pain_awareness).toBe(150);
    expect(totals.need_definition).toBe(0); // 唯一列 null → 跳過 → 0
    expect(totals.solution_exploration).toBe(200);
    expect(totals.spec_comparison).toBe(0);
    expect(totals.reputation_validation).toBe(0);
    expect(totals.final_decision).toBe(0);
    expect(totals.repurchase_retention).toBe(0);
  });

  it('excludes unknown / unclassified stages (not a funnel node) and non-number volumes', () => {
    const totals = aggregateStageVolumes([
      row('unclassified', 999),
      row('', 5),
      { stage: 'pain_awareness', avgMonthlySearches: '300' }, // 非 number → 跳過（C12）
      row('pain_awareness', 300),
    ]);
    expect(Object.keys(totals)).not.toContain('unclassified');
    expect(totals.pain_awareness).toBe(300); // 字串 '300' 不計、僅 number 300
  });

  it('empty input → every stage 0 (never null; 全 7 階段仍在列)', () => {
    const totals = aggregateStageVolumes([]);
    expect(Object.values(totals)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('TC-51 · barHeightPct (柱高 ∝ 搜量、對最大值歸一)', () => {
  it('normalizes volume to the max stage volume (真測比例)', () => {
    expect(barHeightPct(100, 100)).toBe(100);
    expect(barHeightPct(50, 100)).toBe(50);
    expect(barHeightPct(25, 200)).toBe(12.5);
    expect(barHeightPct(0, 100)).toBe(0);
  });

  it('maxVolume ≤ 0 (all stages empty) → 0, no division by zero', () => {
    expect(barHeightPct(0, 0)).toBe(0);
    expect(barHeightPct(5, 0)).toBe(0);
  });
});

describe('TC-51 · stageTrendPct (階段間變化 %)', () => {
  it('computes (current - previous) / previous * 100', () => {
    expect(stageTrendPct(110, 100)).toBe(10);
    expect(stageTrendPct(90, 100)).toBe(-10);
    expect(stageTrendPct(100, 100)).toBe(0);
    expect(stageTrendPct(0, 300)).toBe(-100); // 掉到零 = -100%
  });

  it('previous ≤ 0 → null (no baseline; mirrors trend.ts first===0)', () => {
    expect(stageTrendPct(50, 0)).toBeNull();
    expect(stageTrendPct(0, 0)).toBeNull();
  });
});

describe('TC-51 · computeFunnelStages (7 節點步驟號 1→7 + 柱高比例 + 逐階段趨勢 + 0-not-hidden)', () => {
  // pain 400(max) · need 200 · sol 300 · spec 0(空階段) · rep 100 · final 50 · repurch 25
  const stages = computeFunnelStages([
    row('pain_awareness', 400),
    row('need_definition', 200),
    row('solution_exploration', 300),
    // spec_comparison: 無列 → 0（0-not-hidden）
    row('reputation_validation', 100),
    row('final_decision', 50),
    row('repurchase_retention', 25),
  ]);

  it('always emits all 7 stages in canonical order with 步驟號 1→7 + enum↔zh (SSOT 複用)', () => {
    expect(stages.map((s) => s.stage)).toEqual([...JOURNEY_STAGES]);
    expect(stages.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // enum↔zh 複用 journeyStages 單點（drift guard）。
    expect(stages.map((s) => s.label)).toEqual([
      '痛點覺察',
      '需求確立',
      '方案探索',
      '規格比較',
      '口碑驗證',
      '最終決策',
      '回購維護',
    ]);
  });

  it('bar heights ∝ stage volume normalized to the max (真測比例)', () => {
    expect(stages.map((s) => s.heightPct)).toEqual([100, 50, 75, 0, 25, 12.5, 6.25]);
  });

  it('0-not-hidden: the empty stage stays in the list with volume 0 (never null)', () => {
    const spec = stages[3];
    expect(spec.stage).toBe('spec_comparison');
    expect(spec.volume).toBe(0);
    expect(spec.heightPct).toBe(0);
  });

  it('trend % is the stage-to-stage change; first stage null; previous-0 → null', () => {
    expect(stages.map((s) => s.trendPct)).toEqual([
      null, // 痛點覺察：首階段無前值
      -50, // 需求確立：(200-400)/400
      50, // 方案探索：(300-200)/200
      -100, // 規格比較：(0-300)/300（掉到零）
      null, // 口碑驗證：前階段(規格比較)=0 → 無基準
      -50, // 最終決策：(50-100)/100
      -50, // 回購維護：(25-50)/50
    ]);
  });

  it('undefined / empty rows → all 7 stages present, volume 0, height 0, trend null', () => {
    for (const input of [undefined, []] as const) {
      const empty = computeFunnelStages(input);
      expect(empty).toHaveLength(7);
      expect(empty.every((s) => s.volume === 0 && s.heightPct === 0)).toBe(true);
      expect(empty.every((s) => s.trendPct === null)).toBe(true);
    }
  });
});

describe('TC-51 · formatStageTrend (arrow + signed %；缺值 → null)', () => {
  it('null → null (首階段 / 前階段 0 → 無趨勢顯示)', () => {
    expect(formatStageTrend(null)).toBeNull();
  });

  it('≥ 0 → up arrow (0 是 up 邊界)', () => {
    expect(formatStageTrend(11)).toEqual({ text: '↑ 11.0%', up: true });
    expect(formatStageTrend(0)).toEqual({ text: '↑ 0.0%', up: true });
  });

  it('< 0 → down arrow with the magnitude (符號吸收進箭頭)', () => {
    expect(formatStageTrend(-50)).toEqual({ text: '↓ 50.0%', up: false });
    expect(formatStageTrend(-9.1)).toEqual({ text: '↓ 9.1%', up: false });
  });
});
