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
 * - 同字重複時**優先保留含指標（`metrics`）的那筆**。
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
        seedOrigins: candidate.seedOrigins ? [...candidate.seedOrigins] : undefined,
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
  return {
    ...pickRepresentative(existing, incoming, normalizedText),
    // 偏好保留含 keyword_idea_metrics 者（任一筆帶指標即帶上）。
    metrics: existing.metrics ?? incoming.metrics,
    seedOrigins: mergeSeedOrigins(existing.seedOrigins, incoming.seedOrigins),
  };
}

/**
 * 選代表列（決定保留哪筆的 `text`/`source`，FR-2 / AC-2.3）：
 * 1. seed 優先（exact/seed 一律納入並標記；seed 原字保留）。
 * 2. 兩筆同源時，**優先保留含 metrics 的那筆**（拓展回應中只有部分帶 keyword_idea_metrics）。
 * 3. 否則維持既有（首見）。
 */
function pickRepresentative(
  existing: DedupedKeyword,
  incoming: KeywordCandidate,
  normalizedText: string,
): DedupedKeyword {
  const incomingIsSeed = incoming.source === 'seed';
  const existingIsSeed = existing.source === 'seed';
  if (incomingIsSeed !== existingIsSeed) {
    return incomingIsSeed ? { ...incoming, normalizedText } : existing;
  }
  // 同源（皆 seed 或皆 expanded）：incoming 帶指標而 existing 沒有 → 改用 incoming 為代表。
  if (incoming.metrics && !existing.metrics) {
    return { ...incoming, normalizedText };
  }
  return existing;
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
