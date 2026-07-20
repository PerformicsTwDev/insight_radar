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
  // RED stub (T4.4): placeholder labels so the enum↔zh 鎖死映射 lock fails red.
  pain_awareness: '',
  need_definition: '',
  solution_exploration: '',
  spec_comparison: '',
  reputation_validation: '',
  final_decision: '',
  repurchase_retention: '',
};

/** 解析後的階段顯示資訊：合法 stage → step(1-7)+中文；未分類/未知 → step null（缺值不編步驟，C12）。 */
export interface ResolvedJourneyStage {
  readonly step: number | null;
  readonly label: string;
  readonly known: boolean;
}

/** 型別守衛：值是否為 7 階段之一（表格列 `stage` 為 unknown → 需防禦性收窄）。 */
export function isJourneyStage(_value: unknown): _value is JourneyStage {
  // RED stub (T4.4): not implemented — always false so lock/resolve tests fail red.
  return false;
}

/** 合法 stage → 步驟號（1-7；= JOURNEY_STAGES 中的序 +1）。 */
export function journeyStageStep(_stage: JourneyStage): number {
  // RED stub (T4.4): not implemented — wrong step so per-value tests fail red.
  return 0;
}

/** 解析表格列的 `stage`（unknown）→ 步驟號 + 中文 label；未分類/未知 → step null + 空 label。 */
export function resolveJourneyStage(_value: unknown): ResolvedJourneyStage {
  // RED stub (T4.4): not implemented — never known so resolve tests fail red.
  return { step: null, label: '', known: false };
}
