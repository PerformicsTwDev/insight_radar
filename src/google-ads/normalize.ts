import type { DedupedKeyword, KeywordCandidate } from './keyword.types';

/**
 * 正規化關鍵字文字（NFR-7，去重 + 快取共用同一 key）。
 *
 * `normalizedText = lowercase( collapseWhitespace( trim( NFKC(text) ) ) )`
 * 即：NFKC 正規化 → trim → 多重空白（含全形空白經 NFKC 後）收斂為單一半形空白 → lowercase。
 *
 * ⚠ 去重 key 與快取 key **必須**呼叫同一個 `normalizeText`，否則造成快取 miss + 重複貼標
 * （正確性與效能的共同單點，Design §4.1 / §11）。不做繁簡轉換、不做同義詞合併。
 */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 跨批 + 與使用者輸入合併去重（FR-2）。以 `normalizedText` 為 key：
 * - 同字重複時**優先保留含指標（`hasMetrics`）的那筆**。
 * - seed 一律納入：seed 與 expanded 撞字時保留 `source='seed'` 與 seed 原字 `text`。
 * - 合併 `seedOrigins`（去重、保持首見順序）。
 * - 輸出保持各 key **首見順序**。
 */
export function dedupeMerge(candidates: KeywordCandidate[]): DedupedKeyword[] {
  const byKey = new Map<string, DedupedKeyword>();

  for (const candidate of candidates) {
    const normalizedText = normalizeText(candidate.text);
    const existing = byKey.get(normalizedText);

    if (!existing) {
      byKey.set(normalizedText, {
        ...candidate,
        normalizedText,
        seedOrigins: candidate.seedOrigins ? [...candidate.seedOrigins] : candidate.seedOrigins,
      });
      continue;
    }

    byKey.set(normalizedText, mergeInto(existing, candidate, normalizedText));
  }

  return [...byKey.values()];
}

/** 將 `incoming` 併入 `existing`（同一 normalizedText）。 */
function mergeInto(
  existing: DedupedKeyword,
  incoming: KeywordCandidate,
  normalizedText: string,
): DedupedKeyword {
  // seed 優先：保留 seed 的 source 與原字（exact/seed 一律納入並標記）。
  const seedWins = incoming.source === 'seed' && existing.source !== 'seed';
  const base = seedWins ? { ...incoming, normalizedText } : existing;

  return {
    ...base,
    // 任一筆帶指標即視為有指標（偏好保留含 keyword_idea_metrics 者）。
    hasMetrics: Boolean(existing.hasMetrics) || Boolean(incoming.hasMetrics),
    seedOrigins: mergeSeedOrigins(existing.seedOrigins, incoming.seedOrigins),
  };
}

/** 合併兩組 seedOrigins：去重、保持首見順序；皆空則回 undefined。 */
function mergeSeedOrigins(a?: string[], b?: string[]): string[] | undefined {
  if (!a && !b) {
    return undefined;
  }
  const merged: string[] = [];
  for (const origin of [...(a ?? []), ...(b ?? [])]) {
    if (!merged.includes(origin)) {
      merged.push(origin);
    }
  }
  return merged;
}
