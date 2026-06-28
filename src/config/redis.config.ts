import { registerAs } from '@nestjs/config';

export interface RedisConfig {
  url: string;
}

/** Redis 連線設定（已由 Joi schema 驗證 scheme）。 */
export const redisConfig = registerAs('redis', (): RedisConfig => ({
  url: process.env.REDIS_URL as string,
}));
