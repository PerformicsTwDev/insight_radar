/**
 * SERP 錯誤分類（單點；`SerpApiProvider` 退避判定 + `SerpService` per-query 韌性共用）。
 *
 * **暫時性（transient）**＝可重試/可降級：數值 429/5xx、傳輸層系統碼、AbortError、undici `fetch failed`。
 * **非暫時性（contract/config）**＝系統性、重試無益（如 4xx `InvalidArgument`/401 憑證錯、DB 錯）→ 應**浮現**
 * 而非靜默降級（比照 `ClusteringContractError` 精神，#530）。
 */

/** 傳輸層暫時性錯誤碼（同 embeddings；長跑 HTTP 最常見的暫時失敗）。 */
const TRANSIENT_TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** 暫時性：數值 429/5xx，或傳輸層暫時錯（node 系統碼 / AbortError / undici fetch failed）。 */
export function isTransientSerpError(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown; name?: unknown } | null;
  const status =
    typeof e?.status === 'number' ? e.status : typeof e?.code === 'number' ? e.code : undefined;
  if (status === 429 || (typeof status === 'number' && status >= 500 && status < 600)) {
    return true;
  }
  if (typeof e?.code === 'string' && TRANSIENT_TRANSPORT_CODES.has(e.code)) {
    return true;
  }
  if (e?.name === 'AbortError') {
    return true;
  }
  return err instanceof Error && /fetch failed/i.test(err.message);
}
