/**
 * 意圖語意映射（C2 正確性單點）——I/C/T/N 的 **color / 中文 label 單一權威來源**。
 * 元件、chips、圖表**只**經此取意圖色與中文，禁各自映射（防顏色/中文跨處漂移）。
 * 與 `src/index.css` `@theme` 的 `--color-intent-*` 同值——**此為 JS 權威**（snapshot 守，見 intentMap.test）。
 */
export type IntentKey = 'informational' | 'commercial' | 'transactional' | 'navigational';

export interface IntentMeta {
  readonly color: string;
  readonly zh: string;
}

export const intentMap: Readonly<Record<IntentKey, IntentMeta>> = {
  informational: { color: '#5BC0EB', zh: '資訊型' },
  commercial: { color: '#52b788', zh: '商業型' },
  transactional: { color: '#FFD166', zh: '交易型' },
  navigational: { color: '#9B5DE5', zh: '導航型' },
};
