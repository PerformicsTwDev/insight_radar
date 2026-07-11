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
}

export const authConfig = registerAs('auth', (): AuthConfig => ({
  argon2MemoryKib: Number(process.env.ARGON2_MEMORY_KIB),
  argon2TimeCost: Number(process.env.ARGON2_TIME_COST),
  argon2Parallelism: Number(process.env.ARGON2_PARALLELISM),
  minPasswordLen: Number(process.env.AUTH_MIN_PASSWORD_LEN),
}));
