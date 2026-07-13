import { registerAs } from '@nestjs/config';

/** 認證/密碼設定（M10，Design §14/§17.2）。值已由 env.validation Joi schema 驗證/補預設。 */
export interface AuthConfig {
  /** argon2id 記憶體成本（KiB），OWASP 下限 19456（19 MiB）。 */
  argon2MemoryKib: number;
  /** argon2id 迭代數（time cost）。 */
  argon2TimeCost: number;
  /** argon2id 並行度。 */
  argon2Parallelism: number;
  /** 密碼最小長度（弱密碼 → 驗證錯，S7/AC-24.1）。 */
  minPasswordLen: number;
  /** session 祕密（★redact；Joi fail-fast，不入 log/fixture）。reserved——目前 sid 為 opaque 隨機值、不以此簽章（ADR-0006）。 */
  sessionSecret: string;
  /** Redis session TTL（毫秒），預設 7 天。 */
  sessionTtlMs: number;
  /** session cookie 名稱（預設 sid）。 */
  cookieName: string;
  /** cookie Secure flag（非 test 預設 true；漏設即降級，S6/NFR-15）。 */
  cookieSecure: boolean;
  /** cookie SameSite（預設 lax，CSRF 雙層之一，FR-26）。 */
  cookieSameSite: 'lax' | 'strict' | 'none';
}

export const authConfig = registerAs('auth', (): AuthConfig => ({
  argon2MemoryKib: Number(process.env.ARGON2_MEMORY_KIB),
  argon2TimeCost: Number(process.env.ARGON2_TIME_COST),
  argon2Parallelism: Number(process.env.ARGON2_PARALLELISM),
  minPasswordLen: Number(process.env.AUTH_MIN_PASSWORD_LEN),
  sessionSecret: process.env.SESSION_SECRET as string,
  sessionTtlMs: Number(process.env.SESSION_TTL_MS),
  cookieName: process.env.SESSION_COOKIE_NAME as string,
  cookieSecure: process.env.SESSION_COOKIE_SECURE !== 'false',
  cookieSameSite: process.env.SESSION_COOKIE_SAMESITE as 'lax' | 'strict' | 'none',
}));
