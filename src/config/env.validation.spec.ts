import { AZURE_OPENAI_API_VERSION_ALLOWLIST } from './azure-api-version.allowlist';
import { validationSchema } from './env.validation';

/** 完整且合法的 env（對齊 .env.test 的 dummy 值）。 */
const validEnv: Record<string, string> = {
  NODE_ENV: 'test',
  API_KEY: 'test-api-key',
  GOOGLE_ADS_CLIENT_ID: 'test-client-id',
  GOOGLE_ADS_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_ADS_REFRESH_TOKEN: 'test-refresh-token',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'test-developer-token',
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: '1234567890',
  GOOGLE_ADS_CUSTOMER_ID: '1234567890',
  AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
  AZURE_OPENAI_API_KEY: 'test-azure-key',
  AZURE_OPENAI_DEPLOYMENT: 'gpt-4o-mini',
  AZURE_OPENAI_API_VERSION: '2024-10-21',
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
};

describe('env validation schema (TC-19 fail-fast)', () => {
  it('accepts a complete, valid environment', () => {
    const { error } = validationSchema.validate(validEnv, { abortEarly: false });
    expect(error).toBeUndefined();
  });

  it.each(['API_KEY', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'AZURE_OPENAI_ENDPOINT', 'DATABASE_URL'])(
    'rejects when required %s is missing',
    (key) => {
      const env: Record<string, string> = { ...validEnv };
      delete env[key];
      const { error } = validationSchema.validate(env, { abortEarly: false });
      expect(error).toBeDefined();
      expect(error?.message).toContain(key);
    },
  );

  it('rejects AZURE_OPENAI_API_VERSION outside the allowlist (allowlist, not lexical >=)', () => {
    const { error } = validationSchema.validate(
      { ...validEnv, AZURE_OPENAI_API_VERSION: '2099-12-31' },
      { abortEarly: false },
    );
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/AZURE_OPENAI_API_VERSION/);
  });

  it('accepts every allowlisted AZURE_OPENAI_API_VERSION value', () => {
    for (const version of AZURE_OPENAI_API_VERSION_ALLOWLIST) {
      const { error } = validationSchema.validate(
        { ...validEnv, AZURE_OPENAI_API_VERSION: version },
        { abortEarly: false },
      );
      expect(error).toBeUndefined();
    }
  });

  // —— M0-R7：運維可調參數納入 Joi（收斂 allowUnknown 的靜默放行）——
  describe('operational tunables (M0-R7)', () => {
    /** Joi `.validate().value` 型別為 `any`；以已知欄位形狀讀取避免 unsafe-access lint。 */
    const validatedValue = (env: Record<string, string>): Record<string, unknown> =>
      validationSchema.validate(env, { abortEarly: false }).value as Record<string, unknown>;

    it('applies documented defaults when the tunables are omitted', () => {
      const { error } = validationSchema.validate(validEnv, { abortEarly: false });
      const value = validatedValue(validEnv);
      expect(error).toBeUndefined();
      expect(value.GOOGLE_ADS_SEED_BATCH_SIZE).toBe(15);
      expect(value.GOOGLE_ADS_QPS).toBe(1);
      expect(value.CACHE_TTL_METRICS_MS).toBe(1814400000);
      expect(value.WORKER_CONCURRENCY).toBe(5);
      expect(value.LOG_LEVEL).toBe('info');
    });

    it('enforces the seed-batch hard cap of 20 (correctness single-point)', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, GOOGLE_ADS_SEED_BATCH_SIZE: '21' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('GOOGLE_ADS_SEED_BATCH_SIZE');
    });

    it('enforces the historical-batch hard cap of 10000', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, GOOGLE_ADS_HISTORICAL_BATCH_SIZE: '10001' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('GOOGLE_ADS_HISTORICAL_BATCH_SIZE');
    });

    it('rejects a non-numeric tunable instead of silently passing it through', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, WORKER_CONCURRENCY: 'lots' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('WORKER_CONCURRENCY');
    });

    it('coerces numeric strings (env always arrives as strings)', () => {
      const env = { ...validEnv, GOOGLE_ADS_SEED_BATCH_SIZE: '10', LLM_BATCH_SIZE: '30' };
      const { error } = validationSchema.validate(env, { abortEarly: false });
      const value = validatedValue(env);
      expect(error).toBeUndefined();
      expect(value.GOOGLE_ADS_SEED_BATCH_SIZE).toBe(10);
      expect(value.LLM_BATCH_SIZE).toBe(30);
    });
  });
});
