/**
 * AI-ideation pure helpers (T1.5, FR-20; Design §6 correctness-point C7). **No
 * React / no IO** → core `src/lib/**` (≥90% coverage gate). The dedupe key is the
 * canonical `normalizedText` — the *same* key the backend, cache, and the bulk
 * selection set use — so a generated keyword that differs from an existing seed
 * only by case / fullwidth / whitespace is correctly treated as a duplicate.
 */

export interface AiIdeationTemplate {
  readonly id: string;
  readonly label: string;
}

/**
 * The 10 ideation templates offered by the sub-card dropdown. These are
 * provisional UI-shell placeholders; the authoritative set is backend FR-35
 * (M12) and gets wired for real at T5.3 (Design §3 / Task.md T1.5 ③).
 */
export const AI_IDEATION_TEMPLATES: readonly AiIdeationTemplate[] = [
  { id: 'long-tail', label: '長尾關鍵字' },
  { id: 'questions', label: '問題型（如何 / 為什麼）' },
  { id: 'comparisons', label: '比較 / 對比' },
  { id: 'competitors', label: '競品與替代品' },
  { id: 'use-cases', label: '使用情境 / 場景' },
  { id: 'audiences', label: '受眾 / 客群' },
  { id: 'modifiers', label: '修飾語（便宜 / 推薦 / 評價）' },
  { id: 'seasonal', label: '季節 / 時事' },
  { id: 'local', label: '在地 / 地區' },
  { id: 'brand-terms', label: '品牌詞延伸' },
];

/**
 * Canonical dedupe key (C7): `lowercase(collapseWhitespace(trim(NFKC(text))))` —
 * mirrors the backend normalize (§17.5) so client-side dedupe agrees with the
 * server's normalizedText.
 */
export function normalizeSeed(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Append newly-generated keywords to the existing seeds, de-duplicated by the C7
 * normalized key (case / width / whitespace-insensitive), order-stable. Existing
 * seeds are preserved verbatim; only genuinely-new keywords — also de-duplicated
 * among themselves — are appended, and empty / whitespace-only entries dropped.
 */
export function appendDedupedSeeds(existing: string[], generated: string[]): string[] {
  const seen = new Set<string>(existing.map(normalizeSeed));
  const out = [...existing];
  for (const keyword of generated) {
    const trimmed = keyword.trim();
    if (trimmed.length === 0) continue;
    const key = normalizeSeed(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
