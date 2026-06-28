import { registerAs } from '@nestjs/config';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  apiKey: string;
}

/** App 層設定（值已由 env.validation Joi schema 驗證/補預設，故直接讀取）。 */
export const appConfig = registerAs('app', (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV as string,
  port: Number(process.env.PORT),
  apiPrefix: process.env.API_PREFIX as string,
  apiKey: process.env.API_KEY as string,
}));
