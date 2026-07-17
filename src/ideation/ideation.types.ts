import type { IdeationTemplate } from './ideation.templates';

/** AI 發想請求（FR-35 / AC-35.1；DTO 驗證後的乾淨型別）。 */
export interface IdeationRequest {
  /** 發想模板（allowlist key，映射 server-controlled directive）。 */
  template: IdeationTemplate;
  /** 種子詞（不可信輸入，S19 注入隔離）。 */
  seeds: string[];
}

/** AI 發想結果（AC-35.1/35.4）：`keywords` 形狀相容 `POST /keyword-analyses` 的 `seeds`。 */
export interface IdeationResult {
  keywords: string[];
}
