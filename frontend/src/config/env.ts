import { z } from 'zod';

/**
 * `VITE_` 前綴 runtime config（Design §14）。**無前端祕密**（session 走 httpOnly cookie、不落 JS）。
 * 全部 optional-with-default——**缺 → 用預設**；**提供了但無效**（壞 enum / 非數字）→ **開機 fail-fast**
 * （`config` 於模組載入即解析、拋錯拒帶壞 config 啟動）。元件/lib **只讀 `config`**，不直接碰 `import.meta.env`。
 */
const num = (d: number) =>
  z.coerce.number().refine(Number.isFinite, 'must be a finite number').default(d);

const EnvSchema = z.object({
  // API origin；`''` = 同源（client 解析為 `window.location.origin`）。openapi path 已含 `/api/v1`，故此值為 origin。
  VITE_API_BASE_URL: z.string().default(''),
  VITE_AUTH_PROVIDER: z.enum(['session', 'apiKey']).default('session'),
  VITE_TREND_STABLE_MAX: num(5), // 穩定型上界（%，0≤%<5）
  VITE_TREND_SURGE_MIN: num(20), // 爆發型下界（%，≥20）
  VITE_DEFAULT_PAGE_SIZE: num(25),
  VITE_MAX_PAGE_SIZE: num(100), // 鏡射後端 QUERY_MAX_PAGE_SIZE
  VITE_OFFSET_MAX_PAGE: num(40), // 超過切 keyset（C5）
  VITE_SSE_HEARTBEAT_TIMEOUT_MS: num(20000),
  VITE_SSE_RETRY_MS: num(3000),
  VITE_POLL_INTERVAL_MS: num(2000),
  VITE_VIRTUAL_ROW_THRESHOLD: num(100),
  VITE_TRACKING_DEFAULT_RANGE: z.enum(['6M', '12M', 'all']).default('12M'),
  VITE_TRACKING_CONTINUE_TOP_N: num(3), // home「從追蹤清單繼續」預設顯示的卡片數（T7.7）
  // T7.12: value = Google Ads resource name (backend contract), NOT a friendly code.
  VITE_DEFAULT_GEO: z.string().default('geoTargetConstants/2158'), // 台灣（T7.9/T7.12）
  VITE_DEFAULT_LANGUAGE: z.string().default('languageConstants/1018'), // 繁中（T7.9/T7.12）
  // AI Search 抓取渠道選項（FR-23，M8）：CSV of labels，enum 對映在 lib/aiSearchForm。
  VITE_AI_CHANNELS: z.string().default('AI Overview,AI Mode,Gemini,ChatGPT'),
});

/** Split a CSV env value into trimmed, non-empty tokens (order-preserving). */
function csv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 型別化 app config（駝峰）。 */
export interface AppConfig {
  readonly apiBaseUrl: string;
  readonly authProvider: 'session' | 'apiKey';
  readonly trendStableMax: number;
  readonly trendSurgeMin: number;
  readonly defaultPageSize: number;
  readonly maxPageSize: number;
  readonly offsetMaxPage: number;
  readonly sseHeartbeatTimeoutMs: number;
  readonly sseRetryMs: number;
  readonly pollIntervalMs: number;
  readonly virtualRowThreshold: number;
  readonly trackingDefaultRange: '6M' | '12M' | 'all';
  readonly trackingContinueTopN: number;
  readonly defaultGeo: string;
  readonly defaultLanguage: string;
  readonly aiChannels: readonly string[];
}

/** 解析 + 驗證 config source（pure；`config` 以 `import.meta.env` 呼叫）。無效 → throw（fail-fast）。 */
export function parseConfig(source: Record<string, unknown>): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid VITE_ config: ${msg}`);
  }
  const e = parsed.data;
  return {
    apiBaseUrl: e.VITE_API_BASE_URL,
    authProvider: e.VITE_AUTH_PROVIDER,
    trendStableMax: e.VITE_TREND_STABLE_MAX,
    trendSurgeMin: e.VITE_TREND_SURGE_MIN,
    defaultPageSize: e.VITE_DEFAULT_PAGE_SIZE,
    maxPageSize: e.VITE_MAX_PAGE_SIZE,
    offsetMaxPage: e.VITE_OFFSET_MAX_PAGE,
    sseHeartbeatTimeoutMs: e.VITE_SSE_HEARTBEAT_TIMEOUT_MS,
    sseRetryMs: e.VITE_SSE_RETRY_MS,
    pollIntervalMs: e.VITE_POLL_INTERVAL_MS,
    virtualRowThreshold: e.VITE_VIRTUAL_ROW_THRESHOLD,
    trackingDefaultRange: e.VITE_TRACKING_DEFAULT_RANGE,
    trackingContinueTopN: e.VITE_TRACKING_CONTINUE_TOP_N,
    defaultGeo: e.VITE_DEFAULT_GEO,
    defaultLanguage: e.VITE_DEFAULT_LANGUAGE,
    aiChannels: csv(e.VITE_AI_CHANNELS),
  };
}

/** 應用層 config——單一來源。缺必填/無效 → 開機 fail-fast。 */
export const config: AppConfig = parseConfig(import.meta.env);
