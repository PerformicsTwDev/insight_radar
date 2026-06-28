import { registerAs } from '@nestjs/config';

export interface DatabaseConfig {
  url: string;
}

/** PostgreSQL 連線設定（已由 Joi schema 驗證 scheme）。 */
export const databaseConfig = registerAs('database', (): DatabaseConfig => ({
  url: process.env.DATABASE_URL as string,
}));
