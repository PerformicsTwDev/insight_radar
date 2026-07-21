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
  GEMINI_API_KEY: 'test-gemini-key',
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CLUSTER_SERVICE_URL: 'http://localhost:8000',
  SESSION_SECRET: 'test-session-secret-0123456789', // M10：required（TC-63 fail-fast）
};

describe('env validation schema (TC-19 fail-fast)', () => {
  it('accepts a complete, valid environment', () => {
    const { error } = validationSchema.validate(validEnv, { abortEarly: false });
    expect(error).toBeUndefined();
  });

  // M11-R3：TRACKING_REFRESH_CRON 以 cron-parser（= BullMQ 同一 parser）自訂驗證——無效 cron fail-fast，
  // 避免逃過驗證 → upsertJobScheduler 擲錯被 bootstrap best-effort catch 吞掉 → 排程靜默停擺。
  it.each(['60 3 * * *', 'not-a-cron', '0 25 * * *', '0 3 * * * * *', '', '   '])(
    'rejects an invalid TRACKING_REFRESH_CRON %j (fail-fast, M11-R3)',
    (cron) => {
      const { error } = validationSchema.validate(
        { ...validEnv, TRACKING_REFRESH_CRON: cron },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('TRACKING_REFRESH_CRON');
    },
  );

  it('accepts a valid TRACKING_REFRESH_CRON', () => {
    const { error } = validationSchema.validate(
      { ...validEnv, TRACKING_REFRESH_CRON: '30 2 * * 1' },
      { abortEarly: false },
    );
    expect(error).toBeUndefined();
  });

  it.each([
    'API_KEY',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'AZURE_OPENAI_ENDPOINT',
    'DATABASE_URL',
    'GEMINI_API_KEY', // M8 embeddings 憑證（★ redact）
    'CLUSTER_SERVICE_URL', // M8 分群服務端點
  ])('rejects when required %s is missing', (key) => {
    const env: Record<string, string> = { ...validEnv };
    delete env[key];
    const { error } = validationSchema.validate(env, { abortEarly: false });
    expect(error).toBeDefined();
    expect(error?.message).toContain(key);
  });

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
      expect(value.INTENT_SCHEMA_VERSION).toBe('v1'); // 預設 → 不致 intent:undefined: 的 namespace
      expect(value.GEMINI_EMBEDDING_DIM).toBe(3072); // 固定 3072（M8-R1）
      expect(value.GEMINI_EMBEDDING_MODEL).toBe('gemini-embedding-001');
      expect(value.GEMINI_EMBEDDING_BATCH_SIZE).toBe(100);
      // NFR-14 hardening 預設（Design §14 config SSOT）。
      expect(value.HELMET_ENABLED).toBe(true);
      expect(value.BODY_LIMIT_MB).toBe(5);
      // M10 auth 預設（Design §14；OWASP argon2id + 密碼最短 10，AC-24.1）。
      expect(value.ARGON2_MEMORY_KIB).toBe(19456);
      expect(value.ARGON2_TIME_COST).toBe(2);
      expect(value.ARGON2_PARALLELISM).toBe(1);
      expect(value.AUTH_MIN_PASSWORD_LEN).toBe(10);
      // M10 session 預設（Design §14）。
      expect(value.SESSION_TTL_MS).toBe(604800000);
      expect(value.SESSION_COOKIE_NAME).toBe('sid');
      expect(value.SESSION_COOKIE_SECURE).toBe(true);
      expect(value.SESSION_COOKIE_SAMESITE).toBe('lax');
      // M11 tracking 預設（Design §14；AC-28.7 清單/成員上限、NFR-16 加成員請求上限）。
      expect(value.TRACKING_MAX_LISTS).toBe(50);
      expect(value.TRACKING_MAX_MEMBERS_PER_LIST).toBe(500);
      expect(value.TRACKING_MAX_ITEMS_PER_REQUEST).toBe(500);
      expect(value.TRACKING_BACKFILL_MONTHS).toBe(12); // AC-29.1 回填月數（Ads 原生窗）
      expect(value.TRACKING_KEEP_SERIES_ON_DELETE).toBe(false); // AC-28.2 刪清單預設連帶刪時序
      // M13 capture ingestion 預設（Design §14；AC-36.5 批次/body 上限）。
      expect(value.INGEST_BATCH_MAX).toBe(500);
      expect(value.INGEST_BODY_LIMIT_MB).toBe(10);
      // M13 extension bridge 能力協商基準預設（Design §14；S21/NFR-21/AC-51.4）：現 confirmed 3 + 期望擴充。
      expect(value.EXTENSION_BRIDGE_REQUIRED_FEATURES).toBe(
        'threadsSearch,googleSerp,chatGpt,geminiApp,googleAiMode,googleSearch,facebook,dcard,ptt,readability',
      );
      // M13 CAPTURE_PAT_ENABLED（extension direct-push v2 PAT 認證開關）：reserved（NG14、本期無消費者），
      // 預設 false——僅型別驗證（避免 typo 靜默放行），不接線任何行為（Design §14）。
      expect(value.CAPTURE_PAT_ENABLED).toBe(false);
    });

    it('rejects a non-boolean CAPTURE_PAT_ENABLED (reserved v2 flag is still type-validated, not silently passed)', () => {
      // reserved（v2/NG14）但已入 Joi：非布林值 → fail-fast，不因 allowUnknown 靜默放行（NFR-5）。
      const { error } = validationSchema.validate(
        { ...validEnv, CAPTURE_PAT_ENABLED: 'not-a-bool' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('CAPTURE_PAT_ENABLED');
    });

    it('fail-fasts when SESSION_SECRET is missing (M10 required secret, TC-63)', () => {
      const noSecret: Record<string, string> = { ...validEnv };
      delete noSecret.SESSION_SECRET;
      const { error } = validationSchema.validate(noSecret, { abortEarly: false });
      expect(error?.message).toContain('SESSION_SECRET');
    });

    it('enforces the argon2 / password-length floors (S7: params too low = weak hashing)', () => {
      // 低於 OWASP/spec 下限 → fail-fast，避免弱雜湊/弱密碼策略（Design §14 / AC-24.1）。
      for (const [key, below] of [
        ['ARGON2_MEMORY_KIB', '8192'],
        ['ARGON2_TIME_COST', '1'],
        ['AUTH_MIN_PASSWORD_LEN', '8'],
      ] as const) {
        const { error } = validationSchema.validate(
          { ...validEnv, [key]: below },
          { abortEarly: false },
        );
        expect(error?.message).toContain(key);
      }
    });

    it('pins GEMINI_EMBEDDING_DIM to 3072 (rejects 768/1536 until a vector-type migration exists, M8-R1)', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, GEMINI_EMBEDDING_DIM: '768' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('GEMINI_EMBEDDING_DIM');
    });

    it('defaults SERP off → SERP credentials not required (MVP pure-keyword)', () => {
      const { error } = validationSchema.validate(validEnv, { abortEarly: false });
      expect(error).toBeUndefined(); // validEnv has no SERP_* keys
      expect(validatedValue(validEnv).SERP_ENABLED).toBe(false);
    });

    it('requires SERP_API_KEY / SERP_API_URL when SERP_ENABLED=true (Joi conditional)', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, SERP_ENABLED: 'true' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('SERP_API_KEY');
    });

    it('requires CLUSTER_SERVICE_URL and defaults the cluster-service tunables (M8)', () => {
      const { error } = validationSchema.validate(validEnv, { abortEarly: false });
      const value = validatedValue(validEnv);
      expect(error).toBeUndefined();
      expect(value.CLUSTER_SERVICE_TIMEOUT_MS).toBe(90000);
      expect(value.CLUSTER_SERVICE_RETRIES).toBe(2);
      expect(value.CLUSTER_SERVICE_BACKOFF_BASE_MS).toBe(1000);
    });

    it('rejects a non-URI CLUSTER_SERVICE_URL (fail-fast, not lexical)', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, CLUSTER_SERVICE_URL: 'not-a-url' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('CLUSTER_SERVICE_URL');
    });

    it('defaults the topic naming tunables (batch/prompt/schema versions, M8)', () => {
      const { error } = validationSchema.validate(validEnv, { abortEarly: false });
      const value = validatedValue(validEnv);
      expect(error).toBeUndefined();
      expect(value.TOPIC_LLM_BATCH_CLUSTERS).toBe(20);
      expect(value.TOPIC_PROMPT_VERSION).toBe('v1');
      expect(value.TOPIC_SCHEMA_VERSION).toBe('v1');
    });

    it('rejects a malformed TOPIC_SCHEMA_VERSION (no `:` injection)', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, TOPIC_SCHEMA_VERSION: 'v1:evil' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('TOPIC_SCHEMA_VERSION');
    });

    // —— T8.13：M8 全 env 盤點——確認整批 embeddings/SERP/cluster/topics 可調參數 default 一致套用 ——
    it('applies all M8 defaults when the tunables are omitted (embeddings/SERP/cluster/topics)', () => {
      const { error } = validationSchema.validate(validEnv, { abortEarly: false });
      const value = validatedValue(validEnv);
      expect(error).toBeUndefined();
      // embeddings
      expect(value.GEMINI_EMBEDDING_MODEL).toBe('gemini-embedding-001');
      expect(value.GEMINI_EMBEDDING_TASK_TYPE).toBe('CLUSTERING');
      expect(value.GEMINI_EMBEDDING_BATCH_SIZE).toBe(100);
      expect(value.GEMINI_EMBEDDING_CONCURRENCY).toBe(4);
      expect(value.GEMINI_EMBEDDING_MAX_RETRIES).toBe(5);
      expect(value.GEMINI_EMBEDDING_BACKOFF_BASE_MS).toBe(500);
      expect(value.EMBEDDING_SCHEMA_VERSION).toBe('v1');
      expect(value.CACHE_TTL_EMBEDDING_MS).toBe(5184000000);
      // SERP（預設關閉→純關鍵字；憑證免填）
      expect(value.SERP_ENABLED).toBe(false);
      expect(value.SERP_TOP_N).toBe(5);
      expect(value.SERP_FRESHNESS_DAYS).toBe(30);
      expect(value.SERP_MAX_RETRIES).toBe(3);
      expect(value.SERP_BACKOFF_BASE_MS).toBe(500);
      // cluster-service
      expect(value.CLUSTER_SERVICE_TIMEOUT_MS).toBe(90000);
      expect(value.CLUSTER_SERVICE_RETRIES).toBe(2);
      expect(value.CLUSTER_SERVICE_BACKOFF_BASE_MS).toBe(1000);
      // topics
      expect(value.TOPIC_LLM_BATCH_CLUSTERS).toBe(20);
      expect(value.TOPICS_QUEUE_CONCURRENCY).toBe(3);
    });

    it.each(['EMBEDDING_SCHEMA_VERSION', 'TOPIC_PROMPT_VERSION', 'TOPIC_SCHEMA_VERSION'])(
      'rejects a non-`v\\d+` %s (cache-namespace version pin)',
      (key) => {
        const { error } = validationSchema.validate(
          { ...validEnv, [key]: 'nope' },
          { abortEarly: false },
        );
        expect(error).toBeDefined();
        expect(error?.message).toContain(key);
      },
    );

    it('pins GEMINI_EMBEDDING_BATCH_SIZE to the 500 hard cap (>500 order bug)', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, GEMINI_EMBEDDING_BATCH_SIZE: '501' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('GEMINI_EMBEDDING_BATCH_SIZE');
    });

    it('requires SERP_API_URL as a URI when SERP_ENABLED=true', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, SERP_ENABLED: 'true', SERP_API_KEY: 'k', SERP_API_URL: 'not-a-url' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('SERP_API_URL');
    });

    it('defaults SerpAPI AI adapters off + tunable defaults (M14, reserved)', () => {
      const value = validatedValue(validEnv); // validEnv has no SERPAPI_AI_* keys
      expect(value.SERPAPI_AI_ENABLED).toBe(false);
      expect(value.SERPAPI_AI_MODE_ENABLED).toBe(false); // AC-38.3 per-engine gate off by default
      expect(value.SERPAPI_BING_COPILOT_ENABLED).toBe(false); // AC-38.4 could, off by default
      expect(value.SERPAPI_AIO_PAGE_TOKEN_TIMEOUT_MS).toBe(50000);
      expect(value.SERPAPI_AI_CREDITS_BUDGET).toBe(1000);
      expect(value.SERPAPI_AI_HL).toBe('zh-tw');
      expect(value.SERPAPI_AI_GL).toBe('tw');
      // T14.7：M14 env 盤點收尾——AI Search 抓取 job worker 並發預設（§14；同 topics/journey/custom-classify）。
      // 由 ai-search.module 消費（reserved feature 之外的實接線參數），此前無測試覆蓋。
      expect(value.AI_SEARCH_QUEUE_CONCURRENCY).toBe(3);
    });

    it.each(['lots', '0', '-1', '1.5'])(
      'rejects a non-positive-integer AI_SEARCH_QUEUE_CONCURRENCY %j instead of silently passing it through (T14.7/NFR-5)',
      (bad) => {
        // reserved feature 之外的實接線 tunable：非正整數 → fail-fast，不因 allowUnknown 靜默放行（NFR-5）。
        const { error } = validationSchema.validate(
          { ...validEnv, AI_SEARCH_QUEUE_CONCURRENCY: bad },
          { abortEarly: false },
        );
        expect(error).toBeDefined();
        expect(error?.message).toContain('AI_SEARCH_QUEUE_CONCURRENCY');
      },
    );

    // —— T15.7：M15 AI Search 分析層版本 env（AI_VISIBILITY_SCHEMA_VERSION + 三線 prompt 版本）——
    // 對齊既有版本 env 慣例（限 `v\d+`、預設 `v1`、擋 `:` 注入 cache namespace，同 INTENT/TOPIC_SCHEMA_VERSION）。
    // prompt-versions.ts 現以 `process.env.X ?? 'v1'` 取值——Joi 於此補上 fail-fast 驗證，且**守恆**該預設行為
    // （不改行為，僅收斂 allowUnknown 的靜默放行 + 版本 pin，NFR-5/NFR-19；Design §14）。
    const M15_VERSION_KEYS = [
      'AI_VISIBILITY_SCHEMA_VERSION',
      'BRAND_EXTRACT_PROMPT_VERSION',
      'SENTIMENT_PROMPT_VERSION',
      'MEDIA_CLASSIFY_PROMPT_VERSION',
    ] as const;

    it('defaults the M15 AI visibility schema + prompt versions to v1 (守恆 prompt-versions.ts 預設)', () => {
      const { error } = validationSchema.validate(validEnv, { abortEarly: false });
      const value = validatedValue(validEnv); // validEnv omits all four M15 version keys
      expect(error).toBeUndefined();
      expect(value.AI_VISIBILITY_SCHEMA_VERSION).toBe('v1');
      expect(value.BRAND_EXTRACT_PROMPT_VERSION).toBe('v1');
      expect(value.SENTIMENT_PROMPT_VERSION).toBe('v1');
      expect(value.MEDIA_CLASSIFY_PROMPT_VERSION).toBe('v1');
    });

    it('accepts valid `v\\d+` overrides for the M15 versions (bump → 下游快取整批失效)', () => {
      const env = {
        ...validEnv,
        AI_VISIBILITY_SCHEMA_VERSION: 'v2',
        BRAND_EXTRACT_PROMPT_VERSION: 'v3',
        SENTIMENT_PROMPT_VERSION: 'v4',
        MEDIA_CLASSIFY_PROMPT_VERSION: 'v5',
      };
      const { error } = validationSchema.validate(env, { abortEarly: false });
      const value = validatedValue(env);
      expect(error).toBeUndefined();
      expect(value.AI_VISIBILITY_SCHEMA_VERSION).toBe('v2');
      expect(value.BRAND_EXTRACT_PROMPT_VERSION).toBe('v3');
      expect(value.SENTIMENT_PROMPT_VERSION).toBe('v4');
      expect(value.MEDIA_CLASSIFY_PROMPT_VERSION).toBe('v5');
    });

    it.each(M15_VERSION_KEYS)(
      'rejects a non-`v\\d+` %s (cache-namespace version pin, no `:` injection — fail-fast, NFR-5)',
      (key) => {
        const { error } = validationSchema.validate(
          { ...validEnv, [key]: 'v1:evil' },
          { abortEarly: false },
        );
        expect(error).toBeDefined();
        expect(error?.message).toContain(key);
      },
    );

    it('rejects a SERPAPI_AIO_PAGE_TOKEN_TIMEOUT_MS that is not under the 60s page_token expiry (AC-38.1)', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, SERPAPI_AIO_PAGE_TOKEN_TIMEOUT_MS: '60000' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('SERPAPI_AIO_PAGE_TOKEN_TIMEOUT_MS');
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

    it('rejects a malformed INTENT_SCHEMA_VERSION (no `:` injection into the cache namespace)', () => {
      const { error } = validationSchema.validate(
        { ...validEnv, INTENT_SCHEMA_VERSION: 'v1:evil' },
        { abortEarly: false },
      );
      expect(error).toBeDefined();
      expect(error?.message).toContain('INTENT_SCHEMA_VERSION');
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
