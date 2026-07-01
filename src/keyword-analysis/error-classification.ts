import {
  BadRequestError,
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from 'openai/core/error';
import { isRetryableAdsError } from '../google-ads/ads-error';

/**
 * 集中錯誤分類矩陣（T7.1，FR-12 · NFR-2/9，Design §11）。把散落各層的分類（`isRetryableAdsError`、intent
 * LLM 例外處理、BullMQ attempts、cache best-effort）彙整為**單一策略詞彙 SSOT**。
 *
 * **兩層重試分工（避免放大 Ads 用量）**：`ADS_BACKOFF_IN_JOB` 由 job 內 `AdsRateLimiter` 指數退避處理、
 * **不重跑整 job**；`INFRA_RETRY_WHOLE_JOB` 才交由 BullMQ 整 job 重試。Ads 暫時性配額**不得**觸發整 job 重試。
 */
export enum RetryStrategy {
  /** Ads 暫時性配額（`RESOURCE_EXHAUSTED` / `RESOURCE_TEMPORARILY_EXHAUSTED`）：job 內指數退避（AdsRateLimiter）。 */
  ADS_BACKOFF_IN_JOB = 'ads_backoff_in_job',
  /** LLM 內容結果（`finish_reason=length` / `content_filter`）：該批 fallback（needsReview），不重試整 job。 */
  LLM_DEGRADE = 'llm_degrade',
  /** 暫時性基礎設施/Redis 故障：BullMQ 整 job 重試（`attempts`）。 */
  INFRA_RETRY_WHOLE_JOB = 'infra_retry_whole_job',
  /** 不可重試（Ads `InvalidArgument`、未知/程式錯誤）：直接拋、不重試（不放大 Ads 用量）。 */
  NO_RETRY = 'no_retry',
}

/** 暫時性基礎設施/連線錯誤碼（Redis/網路）→ 交 BullMQ 整 job 重試。 */
const TRANSIENT_INFRA_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** LLM 內容結果例外（該批降級 fallback，非整 job 失敗）。`refusal` 為結果欄位（非拋出），由 IntentService 處理。 */
function isLlmDegradable(err: unknown): boolean {
  if (err instanceof LengthFinishReasonError || err instanceof ContentFilterFinishReasonError) {
    return true;
  }
  // prompt 端 content_filter 走 HTTP 400 BadRequestError（code='content_filter'）。
  return err instanceof BadRequestError && (err as { code?: unknown }).code === 'content_filter';
}

/** 暫時性基礎設施/Redis 故障（連線碼命中）。 */
function isTransientInfra(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && TRANSIENT_INFRA_CODES.has(code);
}

/**
 * 分類一個錯誤到單一重試/降級策略（Design §11 矩陣）。順序：Ads 暫時性配額 → LLM 內容降級 →
 * 暫時性基礎設施 → 其餘（含 Ads `InvalidArgument`、未知）一律 `NO_RETRY`。
 */
export function classifyError(err: unknown): RetryStrategy {
  if (isRetryableAdsError(err)) {
    return RetryStrategy.ADS_BACKOFF_IN_JOB;
  }
  if (isLlmDegradable(err)) {
    return RetryStrategy.LLM_DEGRADE;
  }
  if (isTransientInfra(err)) {
    return RetryStrategy.INFRA_RETRY_WHOLE_JOB;
  }
  return RetryStrategy.NO_RETRY;
}
