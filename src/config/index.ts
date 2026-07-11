// config 模組 barrel：schema、namespace 設定、allowlist 的單一對外介面。
export * from './env.validation';
export * from './azure-api-version.allowlist';
export * from './app.config';
export * from './auth.config';
export * from './google-ads.config';
export * from './azure.config';
export * from './redis.config';
export * from './database.config';
export * from './queue.config';
export * from './cache.config';
export * from './query.config';
export * from './embeddings.config';
export * from './serp.config';
export * from './clustering.config';
export * from './topics.config';

import { appConfig } from './app.config';
import { authConfig } from './auth.config';
import { googleAdsConfig } from './google-ads.config';
import { azureConfig } from './azure.config';
import { redisConfig } from './redis.config';
import { databaseConfig } from './database.config';
import { queueConfig } from './queue.config';
import { cacheConfig } from './cache.config';
import { queryConfig } from './query.config';
import { embeddingsConfig } from './embeddings.config';
import { serpConfig } from './serp.config';
import { clusteringConfig } from './clustering.config';
import { topicsConfig } from './topics.config';

/** 供 `ConfigModule.forRoot({ load: configNamespaces })` 一次掛載所有 namespace。 */
export const configNamespaces = [
  appConfig,
  authConfig,
  googleAdsConfig,
  azureConfig,
  redisConfig,
  databaseConfig,
  queueConfig,
  cacheConfig,
  queryConfig,
  embeddingsConfig,
  serpConfig,
  clusteringConfig,
  topicsConfig,
];
