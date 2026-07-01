import { stdSerializers as pinoStdSerializers } from 'pino';

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

// ⚠ pino redact 邊界（已知限制）：
//   1) `*.field` 只涵蓋巢狀 1 層——深 ≥2 層或陣列元素內的祕密欄位不會被遮蔽（祕密請記在已知淺路徑）。
//   2) redact 只能依 key 遮蔽「整個值」，無法處理 message / err.message / err.stack 內嵌的祕密子字串。
//      → 由下方 scrubSecrets / errSerializer 補強（M0-R3）。

/**
 * 自由字串內嵌祕密的遮罩規則（M0-R3）。pino `redact` 無法處理錯誤訊息／stack 內嵌的連線字串密碼
 * 或 bearer token，故對任意字串再做一道 regex 遮罩。
 *  - 連線字串憑證：`scheme://user:PASSWORD@host` → 只遮 `:PASSWORD`（保留 user/host/db 便於除錯）。
 *  - Authorization bearer：`Bearer <token>` → 遮 token。
 */
const SCRUB_RULES: { pattern: RegExp; replacement: string }[] = [
  // scheme://user:password@  →  scheme://user:[Redacted]@
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^:/?#@\s]+:)[^@/\s]+@/gi,
    replacement: `$1${REDACT_CENSOR}@`,
  },
  // Bearer <token>
  { pattern: /\b(Bearer\s+)[\w.~+/=-]+/gi, replacement: `$1${REDACT_CENSOR}` },
];

/**
 * Value-based redaction（T7.3 / TC-29 強化）：已註冊的**祕密值**集合。pattern/欄位遮罩無法涵蓋「原始祕密值
 * 內嵌於任意自由文字」（非 keyed、非連線字串、非 Bearer）的洩漏路徑；{@link scrubSecrets} 額外把這些**確切值**
 * 於任何位置整段遮掉，作為 defense-in-depth。由 bootstrap（{@link registerSecretValues}）從 config 餵入。
 */
const registeredSecrets = new Set<string>();
/** 太短的值不註冊——避免與正常字串誤撞而過度遮蔽（真實 token/key 遠長於此）。 */
const MIN_SECRET_LENGTH = 8;

/** 註冊執行期祕密值（bootstrap 從 config 餵入 API key / developer token / OAuth refresh / Azure key / client secret）。 */
export function registerSecretValues(values: (string | undefined | null)[]): void {
  for (const value of values) {
    if (typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) {
      registeredSecrets.add(value);
    }
  }
}

/** 清空已註冊祕密值（測試隔離用）。 */
export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

/**
 * 對單一字串套用 {@link SCRUB_RULES} + value-based 遮罩（已註冊祕密值）；非字串原樣回傳。
 * value-based 用 `split/join` 而非 regex，避免祕密值含 regex metachar 造成注入/漏遮。
 */
export function scrubSecrets<T>(value: T): T {
  if (typeof value !== 'string') {
    return value;
  }
  let out: string = value;
  for (const { pattern, replacement } of SCRUB_RULES) {
    out = out.replace(pattern, replacement);
  }
  for (const secret of registeredSecrets) {
    if (out.includes(secret)) {
      out = out.split(secret).join(REDACT_CENSOR);
    }
  }
  return out as T;
}

/** pino `err` 序列化的最小形狀（避免把 pino 型別擴散到此純函式模組）。 */
interface SerializedError {
  type: string;
  message: string;
  stack?: string;
  [key: string]: unknown;
}

/**
 * pino `serializers.err`（M0-R3）：先做標準錯誤序列化，再把 message / stack 內嵌祕密遮掉。
 * 保留 error type 與其餘欄位，只清洗會夾帶連線字串/憑證的自由字串。
 */
export function errSerializer(err: Error): SerializedError {
  const serialized = pinoStdSerializers.err(err) as unknown as SerializedError;
  serialized.message = scrubSecrets(serialized.message);
  if (typeof serialized.stack === 'string') {
    serialized.stack = scrubSecrets(serialized.stack);
  }
  return serialized;
}
