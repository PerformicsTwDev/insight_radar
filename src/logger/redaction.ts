/** 遮蔽後的取代值。 */
export const REDACT_CENSOR = '[Redacted]';

/**
 * 祕密欄位遮蔽路徑（NFR-5 / TC-29）。
 *
 * T0.10 red stub：空清單（不遮蔽）→ TC-29 轉紅；green 補上完整路徑
 * （developer token / API key / OAuth refresh token / Azure key 及其 camel/snake/env 變體、
 * 巢狀 1 層萬用、config namespace、HTTP headers）。
 */
export const REDACT_PATHS: string[] = [];
