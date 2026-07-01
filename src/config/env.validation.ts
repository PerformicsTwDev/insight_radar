import * as Joi from 'joi';
import { AZURE_OPENAI_API_VERSION_ALLOWLIST } from './azure-api-version.allowlist';

const TEN_DIGIT_CID = /^\d{10}$/;

/**
 * 環境變數驗證 schema（TC-19，fail-fast）。
 *
 * - 缺任一必填 → 啟動拋錯（`ConfigModule.forRoot({ validationSchema })`）。
 * - `AZURE_OPENAI_API_VERSION` 以 **allowlist 集合**比對（非字典序 `>=`，見 src/config/azure-api-version.allowlist.ts）。
 * - 運維可調參數（M0-R7）也納入驗證：給預設、限正整數/範圍，避免 `allowUnknown` 讓 typo/非數值
 *   靜默放行（NFR-5「env 缺值/錯值即 fail-fast」）。對映 Design §14。
 * - 仍未列出的 env key（PATH 等系統變數，以及尚未進場的 M5–M7 參數）由 `ConfigModule` 的
 *   `validationOptions.allowUnknown` 放行。
 */
export const validationSchema = Joi.object({
  // —— App ——
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  API_KEY: Joi.string().required(),
  LOG_LEVEL: Joi.string()
    .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent')
    .default('info'),

  // —— Google Ads（六項憑證）——
  GOOGLE_ADS_CLIENT_ID: Joi.string().required(),
  GOOGLE_ADS_CLIENT_SECRET: Joi.string().required(),
  GOOGLE_ADS_REFRESH_TOKEN: Joi.string().required(),
  GOOGLE_ADS_DEVELOPER_TOKEN: Joi.string().required(),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: Joi.string().pattern(TEN_DIGIT_CID).required(),
  GOOGLE_ADS_CUSTOMER_ID: Joi.string().pattern(TEN_DIGIT_CID).required(),
  // 每批 seed 硬上限 20（>20 → Google Ads InvalidArgument）；預設保守 15（Design §14、正確性單點）。
  GOOGLE_ADS_SEED_BATCH_SIZE: Joi.number().integer().min(1).max(20).default(15),
  GOOGLE_ADS_HISTORICAL_BATCH_SIZE: Joi.number().integer().min(1).max(10000).default(1000),
  GOOGLE_ADS_QPS: Joi.number().positive().default(1),
  // job 內 Ads 暫時性錯誤就地退避重試（與 BullMQ job-level JOB_ATTEMPTS 為兩個獨立維度；Design §11/§14）。
  GOOGLE_ADS_MAX_RETRIES: Joi.number().integer().min(0).default(5),
  GOOGLE_ADS_BACKOFF_BASE_MS: Joi.number().integer().min(0).default(5000),

  // —— Azure OpenAI ——
  AZURE_OPENAI_ENDPOINT: Joi.string().uri().required(),
  AZURE_OPENAI_API_KEY: Joi.string().required(),
  AZURE_OPENAI_DEPLOYMENT: Joi.string().required(),
  AZURE_OPENAI_API_VERSION: Joi.string()
    .valid(...AZURE_OPENAI_API_VERSION_ALLOWLIST)
    .required(),
  AZURE_OPENAI_MAX_RETRIES: Joi.number().integer().min(0).default(5),
  LLM_BATCH_SIZE: Joi.number().integer().min(1).default(30),
  LLM_CONCURRENCY: Joi.number().integer().min(1).default(6),

  // —— Redis / Postgres ——
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),

  // —— Cache / Queue 運維參數（TTL 一律毫秒；Design §14）——
  CACHE_TTL_METRICS_MS: Joi.number().integer().min(0).default(1814400000),
  CACHE_TTL_INTENT_MS: Joi.number().integer().min(0).default(5184000000),
  // intent 快取 namespace 版本（schema/prompt 變更皆 bump 此單一版本 → 整批失效；FR-10）。
  // 限 `v\d+`（如 v1/v2）：避免含 `:` 等字元注入額外 key 段、並 fail-fast 擋拼錯。
  INTENT_SCHEMA_VERSION: Joi.string()
    .pattern(/^v\d+$/)
    .default('v1'),
  WORKER_CONCURRENCY: Joi.number().integer().min(1).default(5),
  JOB_ATTEMPTS: Joi.number().integer().min(1).default(5),
  JOB_BACKOFF_MS: Joi.number().integer().min(0).default(3000),
  JOB_BACKOFF_JITTER: Joi.number().min(0).max(1).default(0.2),
  IDEMP_TTL_MS: Joi.number().integer().min(0).default(86400000),
  JOB_TTL_MS: Joi.number().integer().min(0).default(259200000),
  // —— 讀取層/彙整上限（Design §6.5/§9.3）——
  QUERY_MAX_PAGE_SIZE: Joi.number().integer().min(1).default(200),
  AGG_MAX_BUCKETS: Joi.number().integer().min(1).default(200),
  AGG_MAX_GROUPS: Joi.number().integer().min(1).max(5000).default(1000),
});
