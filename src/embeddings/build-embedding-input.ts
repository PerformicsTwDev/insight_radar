import { sha256Hex } from '../common/sha256';
import type { EmbeddingInput, SerpContext } from './embedding.types';

/**
 * Embedding 輸入 token 上限（Design §16 / TC-39）。⚠ 無真實 tokenizer 依賴 → 以**空白切分的 word 數**保守
 * 近似「token」（word 數通常 ≤ token 數；作為有界輸入的近似上限）。組裝文字超過即截斷，避免 Gemini 端截斷。
 */
export const MAX_EMBEDDING_TOKENS = 2048;

/** 以近似 token（空白切分）截斷並正規化空白（單一空白 join，確保同輸入 → 同輸出 → 穩定 hash）。 */
function truncateToTokens(text: string, maxTokens: number): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  return tokens.slice(0, maxTokens).join(' ');
}

/**
 * 組裝 keyword 的 embedding 輸入（T8.2，FR-16，TC-39）：`keyword` +（若有）top-N SERP title/snippet + PAA +
 * related 串接 → 截到 {@link MAX_EMBEDDING_TOKENS} → 算穩定 `input_hash`（含 `schemaVersion` 與**是否帶 SERP**，
 * 使純關鍵字與帶 SERP 的快取互不污染，TC-50）。SERP 缺失/全空 → 降級純關鍵字（`hasSerp=false`）。
 *
 * 純函式（無 I/O）：taskType/model/dim 不進 input（那些屬 provider 呼叫參數，且維度變更走 schemaVersion bump）。
 */
export function buildEmbeddingInput(
  keyword: string,
  serp: SerpContext | undefined,
  opts: { schemaVersion: string; topN?: number; maxTokens?: number },
): EmbeddingInput {
  const maxTokens = opts.maxTokens ?? MAX_EMBEDDING_TOKENS;
  const parts: string[] = [keyword.trim()];

  if (serp) {
    const organic = typeof opts.topN === 'number' ? serp.organic.slice(0, opts.topN) : serp.organic;
    for (const result of organic) {
      if (result.title?.trim()) parts.push(result.title.trim());
      if (result.snippet?.trim()) parts.push(result.snippet.trim());
    }
    for (const question of serp.peopleAlsoAsk ?? []) {
      if (question.trim()) parts.push(question.trim());
    }
    for (const related of serp.relatedSearches ?? []) {
      if (related.trim()) parts.push(related.trim());
    }
  }

  // SERP 是否實際貢獻內容：parts 超過只有 keyword 的那一項（缺失/全空 → 仍只有 keyword → 降級）。
  const hasSerp = parts.length > 1;
  const text = truncateToTokens(parts.join('\n'), maxTokens);
  const inputHash = sha256Hex(`${opts.schemaVersion}|serp:${hasSerp}|${text}`);

  return { text, inputHash, hasSerp };
}
