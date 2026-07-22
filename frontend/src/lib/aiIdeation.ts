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
 * The 10 v4 ideation templates offered by the sub-card dropdown (T7.11, FR-2 修訂 e /
 * AC-2.4). `id` is the **backend `IDEATION_TEMPLATES` key** (`backend:FR-35` 修訂,
 * server-controlled directive) — kept in sync MANUALLY (the template is not an openapi
 * codegen enum). `label` is the interactive prompt with a 「」 slot the user fills with a
 * keyword; {@link parseIdeationSeed} extracts that keyword as the request seed.
 */
export const AI_IDEATION_TEMPLATES: readonly AiIdeationTemplate[] = [
  { id: 'technical_terms', label: '發想「」的專業術語與技術規格' },
  { id: 'pain_points', label: '找出「」的消費者痛點與常見困難' },
  { id: 'subtopics', label: '挖掘「」的延伸子主題與冷門需求' },
  { id: 'competitor_comparison', label: '比較「」的競品差異與關聯字詞' },
  { id: 'trends', label: '尋找「」的最新趨勢與熱門話題' },
  { id: 'related_products', label: '列出「」的相關產品與輔助工具' },
  { id: 'buying_motivation', label: '分析「」的情感訴求與購買動機' },
  { id: 'cross_industry', label: '探索「」的跨產業關聯與應用場景' },
  { id: 'controversies', label: '整理「」的爭議話題與正反面討論' },
  { id: 'myths', label: '破解「」的常見迷思與謠言' },
];

/**
 * Extract the user-typed seed from a filled template (T7.11): the text inside the 「」
 * slot, trimmed (e.g. `發想「吸塵器」的專業術語…` → `吸塵器`). Returns `''` when the slot
 * is empty / absent, which the card treats as "not submittable".
 */
export function parseIdeationSeed(templateText: string): string {
  return templateText.match(/「(.*?)」/)?.[1]?.trim() ?? '';
}

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
