import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JourneyFunnel } from './JourneyFunnel';

/**
 * TC-51 (漏斗結構斷言, FR-15) — 自製 DOM 漏斗（jstage/jbar 移植）。此層驗**結構**（pixel-golden
 * 延 M6/T6.3，見 `e2e/visual/journey-funnel.visual.spec.ts` `test.fixme`）：**柱高 ∝ 階段搜量
 * 對最大值歸一**（`data-height-pct` 真測比例）、**7 節點步驟號 1→7**、**趨勢 %（逐階段變化）**、
 * **某階段 0 列 → 顯 0 不隱藏**、enum↔zh 複用 `journeyStages` SSOT。rows 與 `JourneyTable` 同資料源
 * （`POST /query {view:'journey'}` 的 `Record<string, unknown>[]`）。
 */

const row = (stage: string, avgMonthlySearches: number | null) => ({
  text: `kw-${stage}`,
  stage,
  avgMonthlySearches,
});

// pain 400(max) · need 200 · sol 300 · spec 空(0) · rep 100 · final 50 · repurch 25
const ROWS = [
  row('pain_awareness', 400),
  row('need_definition', 200),
  row('solution_exploration', 300),
  // spec_comparison: 無列 → 0（0-not-hidden）
  row('reputation_validation', 100),
  row('final_decision', 50),
  row('repurchase_retention', 25),
];

describe('TC-51 · JourneyFunnel (自製 DOM 漏斗結構)', () => {
  it('renders all 7 stages with 步驟號 nodes 1→7 in canonical order', () => {
    render(<JourneyFunnel rows={ROWS} />);
    expect(screen.getAllByTestId('jstage')).toHaveLength(7);
    const nodes = screen.getAllByTestId('jnode');
    expect(nodes.map((n) => n.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  it('maps stage enum → zh label via the journeyStages SSOT (single point, drift guard)', () => {
    render(<JourneyFunnel rows={ROWS} />);
    for (const zh of [
      '痛點覺察',
      '需求確立',
      '方案探索',
      '規格比較',
      '口碑驗證',
      '最終決策',
      '回購維護',
    ]) {
      expect(screen.getByText(zh)).toBeInTheDocument();
    }
  });

  it('bar heights are ∝ stage volume normalized to the max (真測比例)', () => {
    render(<JourneyFunnel rows={ROWS} />);
    const bars = screen.getAllByTestId('jbar');
    expect(bars.map((b) => b.getAttribute('data-height-pct'))).toEqual([
      '100', // pain 400 = max
      '50', // need 200
      '75', // sol 300
      '0', // spec 空
      '25', // rep 100
      '12.5', // final 50
      '6.25', // repurch 25
    ]);
    // 比例同時反映在 inline height（漏斗實際柱高）。
    expect(bars[1].style.height).toBe('50%');
    expect(bars[2].style.height).toBe('75%');
  });

  it('0-not-hidden: the empty stage still renders, showing 0 (not — , not hidden)', () => {
    render(<JourneyFunnel rows={ROWS} />);
    const stages = screen.getAllByTestId('jstage');
    const specStage = stages[3]; // spec_comparison = 第 4 階段（無列）
    // 空階段柱仍在（0-not-hidden），值顯 0（不隱藏、不顯 —）。
    expect(within(specStage).getByTestId('jbar')).toBeInTheDocument();
    expect(within(specStage).getByText('0')).toBeInTheDocument();
    expect(within(specStage).queryByText('—')).toBeNull();
  });

  it('shows the per-stage trend %: first stage — , then the stage-to-stage change', () => {
    render(<JourneyFunnel rows={ROWS} />);
    const trends = screen.getAllByTestId('jtrend');
    expect(trends[0].textContent).toBe('—'); // 首階段：無前值
    expect(trends[1].textContent).toBe('↓ 50.0%'); // need (200-400)/400
    expect(trends[2].textContent).toBe('↑ 50.0%'); // sol (300-200)/200
    expect(trends[3].textContent).toBe('↓ 100.0%'); // spec (0-300)/300
    expect(trends[4].textContent).toBe('—'); // rep：前階段(spec)=0 → 無基準
  });

  it('localizes stage volumes via formatVolume (thousands separators)', () => {
    render(<JourneyFunnel rows={[row('pain_awareness', 270450)]} />);
    const pain = screen.getAllByTestId('jstage')[0];
    expect(within(pain).getByText('270,450')).toBeInTheDocument();
  });

  it('undefined rows → still renders the full 7-stage funnel, every stage 0 (no crash)', () => {
    render(<JourneyFunnel rows={undefined} />);
    expect(screen.getAllByTestId('jstage')).toHaveLength(7);
    // 全空 → 每階段顯 0（不隱藏）。
    expect(screen.getAllByText('0')).toHaveLength(7);
  });

  it('exposes an accessible chart label', () => {
    render(<JourneyFunnel rows={ROWS} />);
    expect(screen.getByRole('img', { name: '購買歷程搜尋漏斗' })).toBeInTheDocument();
  });
});
