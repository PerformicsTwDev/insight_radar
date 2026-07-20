import { normalizeText } from '../google-ads/normalize';

/**
 * AI Search 關鍵字 canonical 化（T14.6，FR-41；M14-R6/#582 單點）。
 *
 * 以**共用 `normalizeText`**（去重/快取同一規則，NFR-7）正規化 → 去重 → 排序成 canonical order。
 * 這是 idempotency key 與 job payload keywords 的**同一單點**：兩者若各自平行實作，payload 會夾帶 raw
 * keywords，使 processor 對正規化後相同的字（`'Nike'`/`'NIKE '`/`'nike'`）重複 SerpAPI fetch（浪費 credits +
 * 重複 canonical 列 + 灌大 captureCount）。故 idempotency 命中「同一 run」的語意輸入，payload 亦須用**同一組**字。
 */
export function canonicalizeAiSearchKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map(normalizeText))].sort();
}
