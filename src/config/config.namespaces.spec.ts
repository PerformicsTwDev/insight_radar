import { appConfig } from './app.config';
import { azureConfig } from './azure.config';
import { databaseConfig } from './database.config';
import { googleAdsConfig } from './google-ads.config';
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
  AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com',
  AZURE_OPENAI_API_KEY: 'akey',
  AZURE_OPENAI_DEPLOYMENT: 'gpt-4o-mini',
  AZURE_OPENAI_API_VERSION: '2024-10-21',
  LLM_BATCH_SIZE: '30',
  LLM_CONCURRENCY: '6',
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
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

  it('googleAdsConfig maps the six credentials + batch sizes (coerced to number)', () => {
    expect(googleAdsConfig()).toEqual({
      clientId: 'cid',
      clientSecret: 'sec',
      refreshToken: 'ref',
      developerToken: 'dev',
      loginCustomerId: '1234567890',
      customerId: '0987654321',
      seedBatchSize: 15,
      historicalBatchSize: 1000,
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
    });
  });

  it('redisConfig and databaseConfig map their urls', () => {
    expect(redisConfig()).toEqual({ url: 'redis://localhost:6379' });
    expect(databaseConfig()).toEqual({ url: 'postgresql://u:p@localhost:5432/db' });
  });
});
