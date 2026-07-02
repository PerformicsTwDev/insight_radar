import type { ClusterNaming } from './topic-naming.postprocess';
import type { ClusterRepresentation, RepresentativeKeyword } from './representatives';

/**
 * 分群結果組裝純函式（T8.8，FR-18 / TC-45；Design §16.3 persist / §16.4）。把 T8.6 代表字 + T8.7 群命名 +
 * cluster-service `labels`/`probabilities` 組成**持久化前**的中立記錄：每群一列（`TopicClusterRecord`）與**每字一列**
 * （`KeywordAssignment`，topic/parent/intent 由所屬群繼承、confidence=soft probability、label=-1→isNoise）。
 * **純函式**（無 I/O）；repository 才落 DB。群層 intent 與 FR-4 每字 `keyword_intents` 分表互補、不覆寫。
 */

/** 持久化前的每群記錄（對齊 Design §16.4 `TopicCluster` 欄位）。 */
export interface TopicClusterRecord {
  clusterLabel: number;
  topicName: string;
  parentTopic: string;
  intentLabel: string;
  topicType: string;
  reason: string;
  clusterVolume: number | null;
  keywordCount: number;
  /** 群信心 = 代表字 probability 平均（無代表字 → null）。 */
  confidence: number | null;
  representativeKeywords: RepresentativeKeyword[];
}

/** 組裝的每字指派（含由群繼承的命名，供 GET 回應；持久層只落 clusterId/confidence/isNoise）。 */
export interface KeywordAssignment {
  normalizedText: string;
  /** 所屬群 label（noise → null）。 */
  clusterLabel: number | null;
  /** 由所屬群繼承（noise → null）。 */
  topicName: string | null;
  parentTopic: string | null;
  intentLabel: string | null;
  /** HDBSCAN soft probability（noise → 0）。 */
  confidence: number;
  isNoise: boolean;
}

/** 每字關鍵字最小輸入（對齊 labels/probabilities）。 */
export interface AssignmentKeyword {
  normalizedText: string;
}

/** namings 依 clusterLabel 建索引（供繼承查找）。 */
function indexByLabel(namings: ClusterNaming[]): Map<number, ClusterNaming> {
  const byLabel = new Map<number, ClusterNaming>();
  for (const naming of namings) {
    byLabel.set(naming.clusterLabel, naming);
  }
  return byLabel;
}

/**
 * 合併 T8.6 代表字（clusters）+ T8.7 命名（namings）→ 每群一列 `TopicClusterRecord`。
 * 依 clusterLabel 對齊；某群無對應命名 → 以代表字/label 安全補（防呆，正常不發生）。
 */
export function assembleClusterRecords(
  clusters: ClusterRepresentation[],
  namings: ClusterNaming[],
): TopicClusterRecord[] {
  const byLabel = indexByLabel(namings);
  return clusters.map((cluster) => {
    const naming = byLabel.get(cluster.clusterLabel);
    const reps = cluster.representativeKeywords;
    const confidence =
      reps.length > 0 ? reps.reduce((sum, rep) => sum + rep.probability, 0) / reps.length : null;
    return {
      clusterLabel: cluster.clusterLabel,
      topicName: naming?.topicName ?? reps[0]?.text ?? `cluster ${cluster.clusterLabel}`,
      parentTopic: naming?.parentTopic ?? '',
      intentLabel: naming?.intentLabel ?? 'informational',
      topicType: naming?.topicType ?? 'unknown',
      reason: naming?.reason ?? '',
      clusterVolume: cluster.clusterVolume,
      keywordCount: cluster.keywordCount,
      confidence,
      representativeKeywords: reps,
    };
  });
}

/**
 * 每字群指派（TC-45）：對齊 labels/probabilities/keywords → 每字恰一列。
 * label=-1（noise）→ clusterLabel null、topic/parent/intent null、isNoise true；否則由群命名繼承。
 * confidence = 該字 soft probability。
 */
export function assembleAssignments(
  labels: number[],
  probabilities: number[],
  keywords: AssignmentKeyword[],
  namings: ClusterNaming[],
): KeywordAssignment[] {
  if (labels.length !== probabilities.length || labels.length !== keywords.length) {
    throw new Error(
      `assembleAssignments: length mismatch (labels=${labels.length}, probabilities=${probabilities.length}, keywords=${keywords.length})`,
    );
  }
  const byLabel = indexByLabel(namings);
  return keywords.map((keyword, index) => {
    const label = labels[index];
    const confidence = probabilities[index];
    if (label < 0) {
      return {
        normalizedText: keyword.normalizedText,
        clusterLabel: null,
        topicName: null,
        parentTopic: null,
        intentLabel: null,
        confidence,
        isNoise: true,
      };
    }
    const naming = byLabel.get(label);
    return {
      normalizedText: keyword.normalizedText,
      clusterLabel: label,
      topicName: naming?.topicName ?? null,
      parentTopic: naming?.parentTopic ?? null,
      intentLabel: naming?.intentLabel ?? null,
      confidence,
      isNoise: false,
    };
  });
}
