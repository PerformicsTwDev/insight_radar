import {
  BadRequestError,
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from 'openai/core/error';
import type { ParseChatResult } from './intent-labeler.port';

/**
 * 單批韌性 LLM 分類的原始累積（postProcess 前）。`R` 為單筆結果型別（intent＝`{keyword,labels}`、
 * journey＝`{keyword,stage}`）；`collected` 為 LLM 成功回傳的原始結果、`needsReview` 為被降級 fallback
 * 的字（content_filter/refusal/malformed）。
 */
export interface ChunkOutcome<R> {
  collected: R[];
  needsReview: string[];
}

/**
 * **共用**的單批韌性遞迴（T12.5「複用 intent 貼標批次骨架」；FR-4/FR-33 共用）：
 *
 * - `finish_reason=length`（`LengthFinishReasonError`）→ 該批**對半拆再打**，拆到 size 1 仍 length → 該字
 *   fallback（回空 collected，由 postProcess 補預設）。
 * - `content_filter`（completion-side `ContentFilterFinishReasonError` 或 prompt-side HTTP 400 `code=content_filter`）
 *   / refusal / malformed（缺 `results` 陣列）→ 整批 fallback + 列入覆核清單。
 * - 其餘錯誤（429/5xx 已由 SDK maxRetries 處理；非預期/非 content_filter 400）→ 上拋。
 *
 * 純函式（僅依賴傳入的 `callBatch`）；`chunk` 永遠非空（外層只送非空批、遞迴只在 length ≥2 時對半）。
 */
export async function resilientChunk<R>(
  chunk: string[],
  callBatch: (chunk: string[]) => Promise<ParseChatResult<{ results: R[] }>>,
): Promise<ChunkOutcome<R>> {
  try {
    const result = await callBatch(chunk);
    // refusal 或 malformed（strict 為 server-only 保證，client 端不驗；缺 results 仍可能）→ 整批 fallback
    // + 覆核；不得 spread undefined 而崩（M2-R2）。
    if (result.refusal !== null || !Array.isArray(result.parsed?.results)) {
      return { collected: [], needsReview: [...chunk] };
    }
    return { collected: result.parsed.results, needsReview: [] };
  } catch (error) {
    if (error instanceof LengthFinishReasonError) {
      if (chunk.length === 1) {
        return { collected: [], needsReview: [] }; // 拆到底仍 length → postProcess 補 fallback。
      }
      const mid = Math.ceil(chunk.length / 2);
      const left = await resilientChunk(chunk.slice(0, mid), callBatch);
      const right = await resilientChunk(chunk.slice(mid), callBatch);
      return {
        collected: [...left.collected, ...right.collected],
        needsReview: [...left.needsReview, ...right.needsReview],
      };
    }
    if (
      error instanceof ContentFilterFinishReasonError ||
      (error instanceof BadRequestError && error.code === 'content_filter')
    ) {
      // completion-side（200 finish_reason）或 prompt-side（HTTP 400 code=content_filter）內容過濾
      // → 整批 fallback + 覆核（M2-R1）。
      return { collected: [], needsReview: [...chunk] };
    }
    throw error; // 其餘錯誤（429/5xx 已由 SDK maxRetries 處理；非預期/非 content_filter 400 則上拋）。
  }
}
