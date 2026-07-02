import { sha256Hex } from '../common/sha256';
import type { EmbeddingInput, SerpContext } from './embedding.types';

/** Embedding 輸入 token 上限（Design §16 / TC-39；gemini-embedding-001 上限）。 */
export const MAX_EMBEDDING_TOKENS = 2048;

/**
 * CJK / 全形字元範圍（中日韓統一表意 + 擴展 A + Hiragana/Katakana + Hangul + 全形/半形）。這些字元多為
 * **1 字 ≈ 1 token**（無空白），故不能用 word 數近似。
 */
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * 近似 token 估計（M8-R1）：⚠ 無真實 tokenizer → 以**字元類別**估——CJK/全形字 ≈ **1 token/字**（無空白，word 數
 * 近似失效、原本 zh 大段永不截斷、爆 Gemini 2048 上限），其餘（拉丁等）≈ **~4 字/token**（0.25/字）。此估對 CJK
 * 保守（不低估）、對拉丁合理，是無 tokenizer 下的可靠上界近似。精確 token 需 `countTokens`（網路呼叫，非純函式）。
 */
function estimateTokens(char: string): number {
  return CJK_RE.test(char) ? 1 : 0.25;
}

/**
 * 依 {@link estimateTokens} 累積截斷 + 正規化空白（單一空白，確保同輸入→同輸出→穩定 hash）。CJK 大段亦會被
 * 正確截斷（M8-R1；原 word 數近似對無空白 CJK 失效）。
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const normalized = text.split(/\s+/).filter(Boolean).join(' ');
  let estimate = 0;
  let end = 0;
  for (const char of normalized) {
    estimate += estimateTokens(char);
    if (estimate > maxTokens) {
      break;
    }
    end += char.length; // 以 UTF-16 單位推進（for..of 逐 code point，代理對 length=2）
  }
  return normalized.slice(0, end);
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
