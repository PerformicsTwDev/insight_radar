import * as Joi from 'joi';
import { AZURE_OPENAI_API_VERSION_ALLOWLIST } from './azure-api-version.allowlist';

const TEN_DIGIT_CID = /^\d{10}$/;

/**
 * 環境變數驗證 schema（TC-19，fail-fast）。
 *
 * - 缺任一必填 → 啟動拋錯（`ConfigModule.forRoot({ validationSchema })`）。
 * - `AZURE_OPENAI_API_VERSION` 以 **allowlist 集合**比對（非字典序 `>=`，見 src/config/azure-api-version.allowlist.ts）。
 * - 未列出的 env key 由 `ConfigModule` 的 `validationOptions.allowUnknown` 放行（PATH 等系統變數）。
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

  // —— Azure OpenAI ——
  AZURE_OPENAI_ENDPOINT: Joi.string().uri().required(),
  AZURE_OPENAI_API_KEY: Joi.string().required(),
  AZURE_OPENAI_DEPLOYMENT: Joi.string().required(),
  AZURE_OPENAI_API_VERSION: Joi.string()
    .valid(...AZURE_OPENAI_API_VERSION_ALLOWLIST)
    .required(),

  // —— Redis / Postgres ——
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
});
