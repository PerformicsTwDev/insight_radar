import type { ChatMessage } from '../intent/intent-labeler.port';
import { TOPIC_INTENT_LABELS } from './topic-naming.schema';

/** 待命名的群（T8.6 代表字 + 量體）。`clusterLabel` 為內部對齊用、不送 LLM。 */
export interface ClusterToName {
  clusterLabel: number;
  /** 群內代表字（T8.6 top-K，已排序）。 */
  representativeKeywords: string[];
  /** Σ avgMonthlySearches（可能為 null）。 */
  clusterVolume: number | null;
  /** 群內關鍵字數。 */
  keywordCount: number;
}

const SYSTEM_PROMPT = `You name SEO keyword topic clusters (Ahrefs-style). For each cluster you get its most representative keywords plus volume/size signals.

For each cluster output:
- topic_name: a short, human-readable topic label (2-5 words) capturing the cluster.
- parent_topic: a broader parent category the topic belongs to (a short label; may repeat across clusters).
- intent_label: the SINGLE dominant search intent of the cluster, one of: ${TOPIC_INTENT_LABELS.join(', ')}.
- topic_type: a short type tag such as "head", "subtopic", "long-tail", or "branded".
- reason: one short sentence justifying the naming/intent.

Rules:
- Output exactly one topic object per input cluster, in the SAME ORDER as given.
- The number of topics MUST equal the number of input clusters.
- Use only these intent_label values: ${TOPIC_INTENT_LABELS.join(', ')}.`;

/** 建構某批群的 chat 訊息（system 定義 + user JSON 陣列；不送內部 clusterLabel）。 */
export function buildTopicNamingMessages(clusters: ClusterToName[]): ChatMessage[] {
  const payload = clusters.map((cluster) => ({
    representativeKeywords: cluster.representativeKeywords,
    clusterVolume: cluster.clusterVolume,
    keywordCount: cluster.keywordCount,
  }));
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Name each keyword topic cluster. Clusters: ${JSON.stringify(payload)}`,
    },
  ];
}
