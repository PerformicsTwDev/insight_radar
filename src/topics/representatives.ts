/**
 * 代表字萃取純函式（T8.6，FR-17，TC-43；Design §16.3 represent 階段 / §16.4 `TopicCluster`）。
 *
 * 吃 cluster-service 回的 `labels`/`probabilities`（對齊關鍵字列）+ 關鍵字指標，產出每群（**排除 noise
 * label=-1**）的代表字（top-K by probability，必要時以「最靠質心 cosine」決勝）、`clusterVolume`（Σ
 * avgMonthlySearches，**null 略過、不補 0**）與 `keywordCount`。**純函式**（無 I/O / DI）→ 好測、確定性。
 */

/** 代表字萃取的關鍵字輸入（snapshot `Keyword` 的結構子集）。 */
export interface RepresentativeInputKeyword {
  text: string;
  normalizedText: string;
  /** 純量搜尋量；缺值 = null（不補 0，正確性單點）。 */
  avgMonthlySearches: number | null;
}

export interface ExtractRepresentativesInput {
  /** 每個關鍵字的群 label（noise = -1）；長度 = 關鍵字數。 */
  labels: number[];
  /** 每個關鍵字的 soft membership probability（noise → 0）；長度 = 關鍵字數。 */
  probabilities: number[];
  /** 關鍵字列（對齊 labels/probabilities）。 */
  keywords: RepresentativeInputKeyword[];
  /** 選配：每個關鍵字的 embedding（對齊）；提供時用於「最靠質心 cosine」決勝並列 probability。 */
  vectors?: number[][];
  /** 每群代表字上限（對齊 cluster-service `top_k`，預設 20）。 */
  topK?: number;
}

/** 單一代表字（含其 soft probability 與搜尋量）。 */
export interface RepresentativeKeyword {
  text: string;
  normalizedText: string;
  /** 該字在群內的 soft membership probability（= 每字 confidence）。 */
  probability: number;
  avgMonthlySearches: number | null;
}

/** 單一群的代表資訊（對齊 `TopicCluster`：representativeKeywords / clusterVolume / keywordCount）。 */
export interface ClusterRepresentation {
  /** HDBSCAN 群 label（≥ 0）。 */
  clusterLabel: number;
  /** 群內關鍵字數。 */
  keywordCount: number;
  /** Σ avgMonthlySearches（null 略過、不補 0）；全群皆 null → null（無資料，不捏造 0）。 */
  clusterVolume: number | null;
  /** top-K 代表字（probability 由高到低；並列時最靠質心 cosine 者優先，無 vectors 則保持原序）。 */
  representativeKeywords: RepresentativeKeyword[];
}

export interface RepresentativesResult {
  /** 各群（排除 noise），依 clusterLabel 升冪。 */
  clusters: ClusterRepresentation[];
  /** noise（label = -1）關鍵字數（供 T8.8 標每字 isNoise）。 */
  noiseCount: number;
}

const DEFAULT_TOP_K = 20;

/** 兩向量 cosine 相似度；任一為零向量 → 0（避免除以 0）。 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom; // 任一為零向量 → 0（避免除以 0 / NaN）
}

/** 群內向量的質心（element-wise 平均）。 */
function centroidOf(vectors: number[][]): number[] {
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i += 1) {
      sum[i] += v[i];
    }
  }
  return sum.map((s) => s / vectors.length);
}

export function extractRepresentatives(input: ExtractRepresentativesInput): RepresentativesResult {
  const { labels, probabilities, keywords, vectors } = input;
  const topK = input.topK ?? DEFAULT_TOP_K;

  if (labels.length !== probabilities.length || labels.length !== keywords.length) {
    throw new Error(
      `extractRepresentatives: length mismatch (labels=${labels.length}, probabilities=${probabilities.length}, keywords=${keywords.length})`,
    );
  }
  if (vectors !== undefined && vectors.length !== labels.length) {
    throw new Error(`extractRepresentatives: vectors length ${vectors.length} != ${labels.length}`);
  }

  // 分群索引（noise = label < 0，只計數；一般群 label >= 0）。
  const clusterMembers = new Map<number, number[]>();
  let noiseCount = 0;
  labels.forEach((label, index) => {
    if (label < 0) {
      noiseCount += 1;
      return;
    }
    const members = clusterMembers.get(label);
    if (members) {
      members.push(index);
    } else {
      clusterMembers.set(label, [index]);
    }
  });

  const clusters: ClusterRepresentation[] = [...clusterMembers.entries()]
    .sort(([a], [b]) => a - b) // clusterLabel 升冪
    .map(([clusterLabel, members]) => {
      // clusterVolume：Σ avgMonthlySearches，null 略過；全 null → null（不捏造 0）。
      let volume = 0;
      let hasVolume = false;
      for (const index of members) {
        const avg = keywords[index].avgMonthlySearches;
        if (avg !== null) {
          volume += avg;
          hasVolume = true;
        }
      }

      // 每群 cosine-to-centroid（僅在提供 vectors 時算；否則一律 0 → 決勝退回原序）。
      let ranked: { index: number; probability: number; cosine: number }[];
      if (vectors !== undefined) {
        const centroid = centroidOf(members.map((index) => vectors[index]));
        ranked = members.map((index) => ({
          index,
          probability: probabilities[index],
          cosine: cosineSimilarity(vectors[index], centroid),
        }));
      } else {
        ranked = members.map((index) => ({ index, probability: probabilities[index], cosine: 0 }));
      }

      // 排序：probability 由高到低 → cosine 決勝 → 原序（穩定）。
      ranked.sort((a, b) => {
        if (a.probability !== b.probability) {
          return b.probability - a.probability;
        }
        if (a.cosine !== b.cosine) {
          return b.cosine - a.cosine;
        }
        return a.index - b.index;
      });

      const representativeKeywords: RepresentativeKeyword[] = ranked
        .slice(0, topK)
        .map(({ index }) => ({
          text: keywords[index].text,
          normalizedText: keywords[index].normalizedText,
          probability: probabilities[index],
          avgMonthlySearches: keywords[index].avgMonthlySearches,
        }));

      return {
        clusterLabel,
        keywordCount: members.length,
        clusterVolume: hasVolume ? volume : null,
        representativeKeywords,
      };
    });

  return { clusters, noiseCount };
}
