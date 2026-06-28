/** 遮蔽後的取代值。 */
export const REDACT_CENSOR = '[Redacted]';

/**
 * 已知祕密欄位名（camel / snake / env 變體）。每個會展開成 top-level 與巢狀 1 層（`*.field`）。
 * 涵蓋 NFR-5/TC-29 點名的四類：developer token、API key、OAuth refresh token、Azure key（+ client secret）。
 */
const SECRET_FIELDS = [
  // developer token
  'developerToken',
  'developer_token',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  // API key（含 app / Azure）
  'apiKey',
  'api_key',
  'API_KEY',
  'azureApiKey',
  'AZURE_OPENAI_API_KEY',
  // OAuth tokens（refresh + 短期 access）
  'refreshToken',
  'refresh_token',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'accessToken',
  'access_token',
  // client secret
  'clientSecret',
  'client_secret',
  'GOOGLE_ADS_CLIENT_SECRET',
  // 通用
  'authorization',
];

const fieldPaths = SECRET_FIELDS.flatMap((field) => [field, `*.${field}`]);

/**
 * pino `redact.paths`（NFR-5 / TC-29）。欄位名變體 + 巢狀 1 層萬用，外加 config namespace
 * 與 HTTP headers 的明確路徑（深層 header 萬用無法涵蓋）。
 */
export const REDACT_PATHS: string[] = [
  ...fieldPaths,
  // config namespace（registerAs）
  'googleAds.developerToken',
  'googleAds.refreshToken',
  'googleAds.clientSecret',
  'azure.apiKey',
  'app.apiKey',
  // 連線字串（含 user:password@host）—— 整段遮蔽，避免密碼隨連線錯誤外洩。
  'database.url',
  'redis.url',
  'DATABASE_URL',
  'REDIS_URL',
  // HTTP headers（pino-http 的 req/res 序列化）
  'req.headers["x-api-key"]',
  'req.headers.authorization',
  'headers["x-api-key"]',
  'headers.authorization',
];

// ⚠ pino redact 邊界（已知限制；後續以 custom `serializers.err` follow-up 補強）：
//   1) `*.field` 只涵蓋巢狀 1 層——深 ≥2 層或陣列元素內的祕密欄位不會被遮蔽（祕密請記在已知淺路徑）。
//   2) 只能依 key 遮蔽「整個值」，無法遮蔽 message / err.message / err.stack 字串內嵌的祕密子字串。
