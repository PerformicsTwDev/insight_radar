import { registerAs } from '@nestjs/config';

/**
 * SerpApi AI adapters 設定（M14，FR-38 / NFR-18；Design §14）——**reserved，預設關**（`SERPAPI_AI_ENABLED=false`）。
 * 憑證/端點沿用 SERP（`SERP_API_KEY`/`SERP_API_URL`，見 serpConfig，不另設）；本 namespace 只放 AI 專屬 tunables。
 * 值已由 env.validation Joi schema 驗證/補預設。
 */
export interface SerpAiConfig {
  /** SerpApi AI adapters 開關（reserved，預設 false；關閉時 provider 短路回 `aiOverview=null`、不打供應商）。 */
  enabled: boolean;
  /** AI Overview `page_token` 二次抓取時限（毫秒，預設 50000）；page_token <1min 過期，須留裕度（AC-38.1）。 */
  aioPageTokenTimeoutMs: number;
  /** 每 job SerpApi credit 預算上限（AC-38.5：內嵌=1、二次抓取=2 credits/query；超出不發送 → degrade，NFR-18）。 */
  creditsBudget: number;
  /** 語言（AC-38.5，預設 zh-tw）。 */
  hl: string;
  /** 地區（AC-38.5，預設 tw）。 */
  gl: string;
}

export const serpAiConfig = registerAs('serpAi', (): SerpAiConfig => ({
  enabled: process.env.SERPAPI_AI_ENABLED === 'true',
  aioPageTokenTimeoutMs: Number(process.env.SERPAPI_AIO_PAGE_TOKEN_TIMEOUT_MS),
  creditsBudget: Number(process.env.SERPAPI_AI_CREDITS_BUDGET),
  hl: process.env.SERPAPI_AI_HL ?? 'zh-tw',
  gl: process.env.SERPAPI_AI_GL ?? 'tw',
}));
