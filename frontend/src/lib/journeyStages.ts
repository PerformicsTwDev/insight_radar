/**
 * 購買歷程 7 階段語意映射（C-class 正確性單點，FR-15）——stage enum ↔ 中文 label +
 * 步驟號的**單一權威來源**。表格 / 漏斗 / badge **只**經此取中文與步驟號，禁各自映射
 * （防中文/步驟跨處漂移）。enum 值與順序對齊 backend `JOURNEY_STAGES`
 * （`journey.schema.ts`，FR-33/AC-33.1）——順序＝購買旅程由淺到深，步驟號 1→7 由此序決定。
 */

/** 購買歷程 7 階段（線性購買旅程；順序＝漏斗由淺到深，index+1 = 步驟號）。 */
export const JOURNEY_STAGES = [
  'pain_awareness',
  'need_definition',
  'solution_exploration',
  'spec_comparison',
  'reputation_validation',
  'final_decision',
  'repurchase_retention',
] as const;

export type JourneyStage = (typeof JOURNEY_STAGES)[number];

/** stage → 中文 label（單一權威；drift guard，見 journeyStages.test）。 */
export const JOURNEY_STAGE_LABELS: Readonly<Record<JourneyStage, string>> = {
  pain_awareness: '痛點覺察',
  need_definition: '需求確立',
  solution_exploration: '方案探索',
  spec_comparison: '規格比較',
  reputation_validation: '口碑驗證',
  final_decision: '最終決策',
  repurchase_retention: '回購維護',
};

/**
 * 解析後的階段顯示資訊（discriminated union）：合法 stage → known + step(1-7) + 中文；
 * 未分類/未知 → 非 known、step null（缺值不編步驟，C12——不臆造階段）。
 */
export type ResolvedJourneyStage =
  | { readonly known: true; readonly step: number; readonly label: string }
  | { readonly known: false; readonly step: null; readonly label: '' };

/** O(1) 成員查找集（避免每次 resolve 線性掃描 JOURNEY_STAGES）。 */
const STAGE_SET: ReadonlySet<string> = new Set(JOURNEY_STAGES);

/** 型別守衛：值是否為 7 階段之一（表格列 `stage` 為 unknown → 需防禦性收窄）。 */
export function isJourneyStage(value: unknown): value is JourneyStage {
  return typeof value === 'string' && STAGE_SET.has(value);
}

/** 合法 stage → 步驟號（1-7；= JOURNEY_STAGES 中的序 +1）。 */
export function journeyStageStep(stage: JourneyStage): number {
  return JOURNEY_STAGES.indexOf(stage) + 1;
}

/** 解析表格列的 `stage`（unknown）→ 步驟號 + 中文 label；未分類/未知 → 非 known + step null。 */
export function resolveJourneyStage(value: unknown): ResolvedJourneyStage {
  if (isJourneyStage(value)) {
    return { known: true, step: journeyStageStep(value), label: JOURNEY_STAGE_LABELS[value] };
  }
  return { known: false, step: null, label: '' };
}
