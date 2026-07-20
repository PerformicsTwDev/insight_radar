import { describe, expect, it } from 'vitest';
import {
  JOURNEY_STAGES,
  JOURNEY_STAGE_LABELS,
  isJourneyStage,
  journeyStageStep,
  resolveJourneyStage,
  type JourneyStage,
} from './journeyStages';

/**
 * TC-25 (FR-15) — 購買歷程 7 階段 enum↔zh + 步驟號 **鎖死映射單點**（C-class 正確性）。
 * enum 值 / 中文 label / 順序（步驟號 1→7 由此序決定）任一漂移即紅——這是對外語意契約，
 * 對齊 backend `JOURNEY_STAGES`（journey.schema.ts / AC-33.1）。逐值真測（每個 enum 對正確中文
 * + 正確步驟號），防跨處各自映射造成的漂移。
 */
describe('TC-25 · journeyStages (C-class 7 階段 enum↔zh + 步驟號單點)', () => {
  it('locks the 7-stage enum order (步驟號 1→7 由此序決定)', () => {
    expect(JOURNEY_STAGES).toEqual([
      'pain_awareness',
      'need_definition',
      'solution_exploration',
      'spec_comparison',
      'reputation_validation',
      'final_decision',
      'repurchase_retention',
    ]);
  });

  it('locks每個 enum 值 ↔ 正確中文 label（drift guard，whole-object 鎖死）', () => {
    expect(JOURNEY_STAGE_LABELS).toEqual({
      pain_awareness: '痛點覺察',
      need_definition: '需求確立',
      solution_exploration: '方案探索',
      spec_comparison: '規格比較',
      reputation_validation: '口碑驗證',
      final_decision: '最終決策',
      repurchase_retention: '回購維護',
    });
  });

  // 逐值真測：每個 enum → 正確步驟號 (1-7) + 正確中文（enum↔zh 逐值鎖死，防漂移）。
  const CASES: ReadonlyArray<readonly [JourneyStage, number, string]> = [
    ['pain_awareness', 1, '痛點覺察'],
    ['need_definition', 2, '需求確立'],
    ['solution_exploration', 3, '方案探索'],
    ['spec_comparison', 4, '規格比較'],
    ['reputation_validation', 5, '口碑驗證'],
    ['final_decision', 6, '最終決策'],
    ['repurchase_retention', 7, '回購維護'],
  ];
  it.each(CASES)('%s → 步驟號 + 中文 label 鎖死', (stage, step, zh) => {
    expect(journeyStageStep(stage)).toBe(step);
    expect(JOURNEY_STAGE_LABELS[stage]).toBe(zh);
    expect(resolveJourneyStage(stage)).toEqual({ step, label: zh, known: true });
  });

  it('isJourneyStage narrows the 7 valid stages and rejects everything else', () => {
    for (const stage of JOURNEY_STAGES) {
      expect(isJourneyStage(stage)).toBe(true);
    }
    // sentinel / 未知 / 空 / 非字串一律 false（表格列 stage 為 unknown → 防禦性收窄）。
    expect(isJourneyStage('unclassified')).toBe(false);
    expect(isJourneyStage('')).toBe(false);
    expect(isJourneyStage(null)).toBe(false);
    expect(isJourneyStage(undefined)).toBe(false);
    expect(isJourneyStage(3)).toBe(false);
    expect(isJourneyStage({ stage: 'pain_awareness' })).toBe(false);
  });

  it('resolveJourneyStage on未分類/未知/null → step null（缺值不編步驟，C12）', () => {
    expect(resolveJourneyStage('unclassified')).toEqual({ step: null, label: '', known: false });
    expect(resolveJourneyStage(null)).toEqual({ step: null, label: '', known: false });
    expect(resolveJourneyStage(undefined)).toEqual({ step: null, label: '', known: false });
    expect(resolveJourneyStage(42)).toEqual({ step: null, label: '', known: false });
  });
});
