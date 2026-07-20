import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JourneyTable } from './JourneyTable';

/**
 * TC-25 (表格, FR-15) — 購買歷程表：每列一個關鍵字，首欄帶**步驟號 badge**（1→7），
 * 階段欄以 7 階段 **enum↔zh 鎖死映射**（`journeyStages` SSOT）顯示中文；月均搜量 null →
 * — （C12，不補 0）；未分類/未知 stage → 步驟與階段皆 —（缺值不編步驟）。空列 → 空狀態。
 * rows 由 `POST /query {view:'journey'}` 帶入（`Record<string, unknown>[]`）。
 */

const ROW = (stage: string, text: string, vol: number | null) => ({
  text,
  normalizedText: text,
  stage,
  avgMonthlySearches: vol,
});

describe('TC-25 · JourneyTable (步驟號 badge + 7 階段 enum↔zh)', () => {
  it('renders one row per keyword with the step-number badge, zh stage label, and 月均搜量', () => {
    render(<JourneyTable rows={[ROW('spec_comparison', 'iphone 16 vs 15 pro', 12000)]} />);

    const row = screen.getByText('iphone 16 vs 15 pro').closest('tr');
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);
    // 步驟號 badge：spec_comparison = 第 4 階段。
    expect(cells.getByText('4')).toBeInTheDocument();
    // 階段 enum↔zh 鎖死：spec_comparison → 規格比較。
    expect(cells.getByText('規格比較')).toBeInTheDocument();
    // 月均搜量本地化。
    expect(cells.getByText('12,000')).toBeInTheDocument();
  });

  // 逐值真測（enum↔zh + 步驟號鎖死）：每個 stage 渲染出正確步驟號 + 正確中文。
  const STAGE_CASES: ReadonlyArray<readonly [string, string, string]> = [
    ['pain_awareness', '1', '痛點覺察'],
    ['need_definition', '2', '需求確立'],
    ['solution_exploration', '3', '方案探索'],
    ['spec_comparison', '4', '規格比較'],
    ['reputation_validation', '5', '口碑驗證'],
    ['final_decision', '6', '最終決策'],
    ['repurchase_retention', '7', '回購維護'],
  ];
  it.each(STAGE_CASES)('stage %s → 步驟號 + 中文 label 逐值鎖死', (stage, step, zh) => {
    render(<JourneyTable rows={[ROW(stage, `kw-${stage}`, 100)]} />);
    const row = screen.getByText(`kw-${stage}`).closest('tr') as HTMLElement;
    expect(within(row).getByText(step)).toBeInTheDocument();
    expect(within(row).getByText(zh)).toBeInTheDocument();
  });

  it('月均搜量 null → — (C12; never 0)', () => {
    render(<JourneyTable rows={[ROW('need_definition', '洗衣精 推薦', null)]} />);
    const row = screen.getByText('洗衣精 推薦').closest('tr') as HTMLElement;
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).queryByText('0')).not.toBeInTheDocument();
  });

  it('未分類 / 未知 stage → 步驟與階段皆 —（no fabricated step, C12）', () => {
    render(<JourneyTable rows={[ROW('unclassified', '尚未分類詞', 500)]} />);
    const row = screen.getByText('尚未分類詞').closest('tr') as HTMLElement;
    // 未知 stage 不編步驟號，也不顯示任一中文階段 label。
    expect(within(row).queryByText('規格比較')).not.toBeInTheDocument();
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('empty rows → 空狀態（不 crash）', () => {
    render(<JourneyTable rows={[]} />);
    expect(screen.getByText(/尚無購買歷程資料/)).toBeInTheDocument();
  });

  it('undefined rows → 空狀態', () => {
    render(<JourneyTable rows={undefined} />);
    expect(screen.getByText(/尚無購買歷程資料/)).toBeInTheDocument();
  });
});
