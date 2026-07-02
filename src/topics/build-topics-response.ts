/**
 * `GET /keyword-analyses/:id/topics` 回應組裝純函式（T8.10b，FR-18 / TC-49；Design §16.3）。把 TopicRun +
 * topic_clusters + keyword_cluster_assignments 組成對外回應：**每字 topic/parent/intent 由所屬群繼承**
 * （clusterId → topic_clusters；noise → null），confidence=assignment soft prob。**不讀/不覆寫 FR-4
 * keyword_intents**（群層 intent 與每字 multi-label 分表互補）。
 */

/** 讀取層 TopicRun 視圖（decoupled，不綁 Prisma 型別）。 */
export interface TopicRunView {
  id: string;
  snapshotId: string;
  status: string;
  progress: unknown;
  clusterCount: number | null;
  noiseCount: number | null;
}

/** 讀取層 topic_clusters 列（含 clusterId 供 assignment 繼承查找）。 */
export interface TopicClusterRow {
  clusterId: string;
  clusterLabel: number;
  topicName: string;
  parentTopic: string;
  intentLabel: string;
  topicType: string;
  reason: string | null;
  clusterVolume: bigint | null;
  keywordCount: number;
  confidence: number | null;
  representativeKeywords: unknown;
}

/** 讀取層 keyword_cluster_assignments 列。 */
export interface AssignmentRow {
  normalizedText: string;
  clusterId: string | null;
  confidence: number;
  isNoise: boolean;
}

export interface TopicClusterDto {
  topicName: string;
  parentTopic: string;
  intentLabel: string;
  topicType: string;
  reason: string | null;
  clusterVolume: number | null;
  keywordCount: number;
  confidence: number | null;
  representativeKeywords: unknown;
}

export interface TopicKeywordDto {
  text: string;
  normalizedText: string;
  topicName: string | null;
  parentTopic: string | null;
  intentLabel: string | null;
  confidence: number;
  isNoise: boolean;
}

export interface TopicsResponse {
  status: string;
  progress: unknown;
  clusters: TopicClusterDto[];
  keywords: TopicKeywordDto[];
  meta: {
    runId: string;
    snapshotId: string;
    clusterCount: number | null;
    noiseCount: number | null;
  };
}

export function buildTopicsResponse(
  run: TopicRunView,
  clusters: TopicClusterRow[],
  assignments: AssignmentRow[],
  keywordTexts: Map<string, string>,
): TopicsResponse {
  const clusterById = new Map(clusters.map((cluster) => [cluster.clusterId, cluster]));

  return {
    status: run.status,
    progress: run.progress,
    clusters: clusters.map((cluster) => ({
      topicName: cluster.topicName,
      parentTopic: cluster.parentTopic,
      intentLabel: cluster.intentLabel,
      topicType: cluster.topicType,
      reason: cluster.reason,
      // BigInt → JSON number（搜尋量加總，實務不超 MAX_SAFE_INTEGER）；null 保留。
      clusterVolume: cluster.clusterVolume === null ? null : Number(cluster.clusterVolume),
      keywordCount: cluster.keywordCount,
      confidence: cluster.confidence,
      representativeKeywords: cluster.representativeKeywords,
    })),
    keywords: assignments.map((assignment) => {
      // 群繼承：clusterId → topic_clusters（noise→null）。**不取 keyword_intents**（分表互補）。
      const cluster =
        assignment.clusterId === null ? undefined : clusterById.get(assignment.clusterId);
      return {
        text: keywordTexts.get(assignment.normalizedText) ?? assignment.normalizedText,
        normalizedText: assignment.normalizedText,
        topicName: cluster?.topicName ?? null,
        parentTopic: cluster?.parentTopic ?? null,
        intentLabel: cluster?.intentLabel ?? null,
        confidence: assignment.confidence,
        isNoise: assignment.isNoise,
      };
    }),
    meta: {
      runId: run.id,
      snapshotId: run.snapshotId,
      clusterCount: run.clusterCount,
      noiseCount: run.noiseCount,
    },
  };
}
