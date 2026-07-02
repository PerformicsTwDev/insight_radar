import type { ClusterToName } from './topic-naming.prompt';
import { TOPIC_INTENT_LABELS, type TopicIntentLabel } from './topic-naming.schema';

/**
 * 群命名後處理（T8.7，FR-18 / TC-44）。**純函式：驗證邊界**——把 LLM 回的 topics 對齊回輸入 clusters，
 * 非法/缺漏/數量不符 → 安全 fallback（可辨識 `degraded` 旗標供 T8.9 標 partial）。strict schema 只在
 * server 端保證（非 refusal/非截斷時），client 端一律清洗。
 */

/** 單群命名結果（對齊 Design §16.4 `TopicCluster` 欄位）。 */
export interface ClusterNaming {
  clusterLabel: number;
  topicName: string;
  parentTopic: string;
  intentLabel: TopicIntentLabel;
  topicType: string;
  reason: string;
  /** true = 此列由 fallback 產生（refusal/filter/length/數量不符/非法），供上層標 partial（NFR-12）。 */
  degraded: boolean;
}

/** 後處理輸入形狀——**刻意寬鬆**：欄位視為未驗證（LLM 仍可能回非法值）。 */
export interface RawTopicNaming {
  topics: Array<{
    topic_name?: unknown;
    parent_topic?: unknown;
    intent_label?: unknown;
    topic_type?: unknown;
    reason?: unknown;
  }>;
}

const FALLBACK_INTENT: TopicIntentLabel = 'informational';
const FALLBACK_TOPIC_TYPE = 'unknown';
const VALID_INTENTS = new Set<string>(TOPIC_INTENT_LABELS);

/** intent_label 清洗：非 4 值（或非字串）→ fallback `informational`（驗證邊界單點）。 */
export function cleanTopicIntent(label: unknown): TopicIntentLabel {
  return typeof label === 'string' && VALID_INTENTS.has(label)
    ? (label as TopicIntentLabel)
    : FALLBACK_INTENT;
}

/** 該群安全 fallback：以首個代表字當 topic_name（無代表字則用 label），intent 預設 informational。 */
function fallbackNaming(cluster: ClusterToName, cause: string): ClusterNaming {
  return {
    clusterLabel: cluster.clusterLabel,
    topicName: cluster.representativeKeywords[0] ?? `cluster ${cluster.clusterLabel}`,
    parentTopic: '',
    intentLabel: FALLBACK_INTENT,
    topicType: FALLBACK_TOPIC_TYPE,
    reason: `degraded: ${cause}`,
    degraded: true,
  };
}

/**
 * 把 LLM 回的 `topics` 依**順序**對齊回輸入 clusters（群無天然 key，只能靠順序）。
 *
 * - `parsed` 為 null（refusal/filter/malformed）或 `topics` 數量 ≠ clusters 數量 → **整批 fallback**
 *   （數量不符時無法安全逐列對齊，保守全降級，避免錯標）。
 * - 數量相符：逐列命名；單列 topic_name 非字串/空 → 該列 fallback；intent_label 非 4 值 → informational。
 * - 保證回傳長度 = clusters.length、每群恰一列。
 */
export function reconcileClusterNamings(
  clusters: ClusterToName[],
  parsed: RawTopicNaming | null,
  cause = 'no LLM result',
): ClusterNaming[] {
  const topics = parsed?.topics;
  if (!Array.isArray(topics) || topics.length !== clusters.length) {
    const reason = topics === undefined ? cause : 'count mismatch';
    return clusters.map((cluster) => fallbackNaming(cluster, reason));
  }
  return clusters.map((cluster, index) => {
    const topic = topics[index];
    if (typeof topic.topic_name !== 'string' || topic.topic_name.trim() === '') {
      return fallbackNaming(cluster, 'invalid entry');
    }
    return {
      clusterLabel: cluster.clusterLabel,
      topicName: topic.topic_name,
      parentTopic: typeof topic.parent_topic === 'string' ? topic.parent_topic : '',
      intentLabel: cleanTopicIntent(topic.intent_label),
      topicType:
        typeof topic.topic_type === 'string' && topic.topic_type.trim() !== ''
          ? topic.topic_type
          : FALLBACK_TOPIC_TYPE,
      reason: typeof topic.reason === 'string' ? topic.reason : '',
      degraded: false,
    };
  });
}
