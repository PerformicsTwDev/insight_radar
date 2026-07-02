import { appConfig } from './app.config';
import { azureConfig } from './azure.config';
import { cacheConfig } from './cache.config';
import { clusteringConfig } from './clustering.config';
import { embeddingsConfig } from './embeddings.config';
import { serpConfig } from './serp.config';
import { databaseConfig } from './database.config';
import { googleAdsConfig } from './google-ads.config';
import { queryConfig } from './query.config';
import { queueConfig } from './queue.config';
import { redisConfig } from './redis.config';

const ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3000',
  API_PREFIX: 'api/v1',
  API_KEY: 'test-api-key',
  GOOGLE_ADS_CLIENT_ID: 'cid',
  GOOGLE_ADS_CLIENT_SECRET: 'sec',
  GOOGLE_ADS_REFRESH_TOKEN: 'ref',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'dev',
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: '1234567890',
  GOOGLE_ADS_CUSTOMER_ID: '0987654321',
  GOOGLE_ADS_SEED_BATCH_SIZE: '15',
  GOOGLE_ADS_HISTORICAL_BATCH_SIZE: '1000',
  GOOGLE_ADS_QPS: '1',
  GOOGLE_ADS_MAX_RETRIES: '5',
  GOOGLE_ADS_BACKOFF_BASE_MS: '5000',
  AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com',
  AZURE_OPENAI_API_KEY: 'akey',
  AZURE_OPENAI_DEPLOYMENT: 'gpt-4o-mini',
  AZURE_OPENAI_API_VERSION: '2024-10-21',
  LLM_BATCH_SIZE: '30',
  LLM_CONCURRENCY: '6',
  AZURE_OPENAI_MAX_RETRIES: '5',
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  WORKER_CONCURRENCY: '5',
  JOB_ATTEMPTS: '5',
  JOB_BACKOFF_MS: '3000',
  JOB_BACKOFF_JITTER: '0.2',
  IDEMP_TTL_MS: '86400000',
  JOB_TTL_MS: '259200000',
  CACHE_TTL_METRICS_MS: '1814400000',
  CACHE_TTL_INTENT_MS: '5184000000',
  INTENT_SCHEMA_VERSION: 'v1',
  QUERY_MAX_PAGE_SIZE: '200',
  AGG_MAX_BUCKETS: '200',
  AGG_MAX_GROUPS: '1000',
  GEMINI_API_KEY: 'gkey',
  GEMINI_EMBEDDING_DIM: '3072',
  GEMINI_EMBEDDING_MODEL: 'gemini-embedding-001',
  GEMINI_EMBEDDING_TASK_TYPE: 'CLUSTERING',
  GEMINI_EMBEDDING_BATCH_SIZE: '100',
  GEMINI_EMBEDDING_CONCURRENCY: '4',
  GEMINI_EMBEDDING_MAX_RETRIES: '5',
  GEMINI_EMBEDDING_BACKOFF_BASE_MS: '500',
  EMBEDDING_SCHEMA_VERSION: 'v1',
  CACHE_TTL_EMBEDDING_MS: '5184000000',
  SERP_ENABLED: 'true',
  SERP_PROVIDER: 'serpapi',
  SERP_API_KEY: 'serpkey',
  SERP_API_URL: 'https://serpapi.com/search',
  SERP_TOP_N: '5',
  SERP_FRESHNESS_DAYS: '30',
  SERP_MAX_RETRIES: '3',
  SERP_BACKOFF_BASE_MS: '500',
  CLUSTER_SERVICE_URL: 'http://cluster-service:8000',
  CLUSTER_SERVICE_TIMEOUT_MS: '90000',
  CLUSTER_SERVICE_RETRIES: '2',
  CLUSTER_SERVICE_BACKOFF_BASE_MS: '1000',
};

describe('config namespaces (registerAs, typed)', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original, ...ENV };
  });

  afterEach(() => {
    process.env = original;
  });

  it('appConfig maps app env (port coerced to number)', () => {
    expect(appConfig()).toEqual({
      nodeEnv: 'test',
      port: 3000,
      apiPrefix: 'api/v1',
      apiKey: 'test-api-key',
    });
  });

  it('googleAdsConfig maps the six credentials + batch sizes + Ads throttle/backoff (coerced to number)', () => {
    expect(googleAdsConfig()).toEqual({
      clientId: 'cid',
      clientSecret: 'sec',
      refreshToken: 'ref',
      developerToken: 'dev',
      loginCustomerId: '1234567890',
      customerId: '0987654321',
      seedBatchSize: 15,
      historicalBatchSize: 1000,
      qps: 1,
      adsMaxRetries: 5,
      adsBackoffBaseMs: 5000,
    });
  });

  it('azureConfig maps azure env + LLM batch/concurrency (coerced to number)', () => {
    expect(azureConfig()).toEqual({
      endpoint: 'https://x.openai.azure.com',
      apiKey: 'akey',
      deployment: 'gpt-4o-mini',
      apiVersion: '2024-10-21',
      llmBatchSize: 30,
      llmConcurrency: 6,
      maxRetries: 5,
    });
  });

  it('redisConfig and databaseConfig map their urls', () => {
    expect(redisConfig()).toEqual({ url: 'redis://localhost:6379' });
    expect(databaseConfig()).toEqual({ url: 'postgresql://u:p@localhost:5432/db' });
  });

  it('queueConfig maps worker/retry/ttl env (coerced to number)', () => {
    expect(queueConfig()).toEqual({
      workerConcurrency: 5,
      jobAttempts: 5,
      jobBackoffMs: 3000,
      jobBackoffJitter: 0.2,
      idempTtlMs: 86400000,
      jobTtlMs: 259200000,
    });
  });

  it('cacheConfig maps cache TTL env (ms) + intent schema version (namespace)', () => {
    expect(cacheConfig()).toEqual({
      metricsTtlMs: 1814400000,
      intentTtlMs: 5184000000,
      intentSchemaVersion: 'v1',
    });
  });

  it('embeddingsConfig maps gemini/embedding env (coerced to number; M8)', () => {
    expect(embeddingsConfig()).toEqual({
      apiKey: 'gkey',
      model: 'gemini-embedding-001',
      taskType: 'CLUSTERING',
      dim: 3072,
      batchSize: 100,
      concurrency: 4,
      maxRetries: 5,
      backoffBaseMs: 500,
      schemaVersion: 'v1',
      cacheTtlMs: 5184000000,
    });
  });

  it('serpConfig maps SERP env; enabled coerced from string, retentionDays undefined when unset (M8)', () => {
    expect(serpConfig()).toEqual({
      enabled: true,
      provider: 'serpapi',
      apiKey: 'serpkey',
      apiUrl: 'https://serpapi.com/search',
      topN: 5,
      freshnessDays: 30,
      retentionDays: undefined, // 未設＝保留全部
      maxRetries: 3,
      backoffBaseMs: 500,
    });
  });

  it('clusteringConfig maps cluster-service env (coerced to number; M8)', () => {
    expect(clusteringConfig()).toEqual({
      serviceUrl: 'http://cluster-service:8000',
      timeoutMs: 90000,
      retries: 2,
      backoffBaseMs: 1000,
    });
  });

  it('queryConfig maps read-layer page-size limit + aggregation bounds (coerced to number)', () => {
    expect(queryConfig()).toEqual({
      maxPageSize: 200,
      aggMaxBuckets: 200,
      aggMaxGroups: 1000,
    });
  });
});
