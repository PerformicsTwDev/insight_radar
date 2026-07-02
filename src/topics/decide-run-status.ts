import type { TopicPhase } from './topic-run.types';

/**
 * 分群 job 最終狀態決策（T8.9，NFR-12）。**純函式**：完整跑完 pipeline（有產出 clusters）後，若任一階段
 * 曾降級（SERP 抓取失敗退純文字、或部分群命名 degraded）→ `partial`；全順利 → `completed`。
 *
 * 注意：embed/cluster 完全失敗（ClusteringUnavailableError 等）不走此函式——那是 pipeline 中斷、由 processor
 * 直接標 `partial`（0 群）。此函式只處理「pipeline 完成但帶降級」的收尾。
 */
export interface DegradeFlags {
  /** SERP 抓取失敗 → 已降級純文字 embedding 繼續。 */
  serpDegraded: boolean;
  /** 至少一個群命名為 fallback（refusal/filter/length/數量不符）。 */
  namingDegraded: boolean;
}

export function decideRunStatus(flags: DegradeFlags): 'completed' | 'partial' {
  return flags.serpDegraded || flags.namingDegraded ? 'partial' : 'completed';
}

/** 各階段完成時的累積進度百分比（persist 完成 = 100）。 */
export const PHASE_PERCENT: Record<TopicPhase, number> = {
  load: 10,
  serp: 25,
  embed: 55,
  cluster: 70,
  represent: 80,
  name: 90,
  persist: 100,
};
