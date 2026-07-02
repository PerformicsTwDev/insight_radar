import { registerAs } from '@nestjs/config';

/** 主題分群/命名設定（值已由 env.validation Joi schema 驗證/補預設；M8，Design §14/§16）。 */
export interface TopicsConfig {
  /** 每批送 LLM 命名的群數（TOPIC_LLM_BATCH_CLUSTERS）。 */
  llmBatchClusters: number;
  /** 命名 prompt 版本（bump 即令下游快取/紀錄失效；限 `v\d+`）。 */
  promptVersion: string;
  /** 命名 json_schema 版本（同上）。 */
  schemaVersion: string;
}

export const topicsConfig = registerAs('topics', (): TopicsConfig => ({
  llmBatchClusters: Number(process.env.TOPIC_LLM_BATCH_CLUSTERS),
  promptVersion: process.env.TOPIC_PROMPT_VERSION ?? 'v1',
  schemaVersion: process.env.TOPIC_SCHEMA_VERSION ?? 'v1',
}));
