import { registerAs } from '@nestjs/config';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  apiKey: string;
  /** CORS 白名單（逗號分隔 `ALLOWED_ORIGINS` 解析；空＝不允許跨域），NFR-14。 */
  allowedOrigins: string[];
  /** SSE heartbeat 事件週期（毫秒），FR-9 AC-9.6/9.7。 */
  sseHeartbeatMs: number;
}

/** 逗號分隔 origin 白名單 → 去空白、去空項的陣列。 */
function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** App 層設定（值已由 env.validation Joi schema 驗證/補預設，故直接讀取）。 */
export const appConfig = registerAs('app', (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV as string,
  port: Number(process.env.PORT),
  apiPrefix: process.env.API_PREFIX as string,
  apiKey: process.env.API_KEY as string,
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
  sseHeartbeatMs: Number(process.env.SSE_HEARTBEAT_MS),
}));
