import { parseExpression } from 'cron-parser';
import * as Joi from 'joi';
import { AZURE_OPENAI_API_VERSION_ALLOWLIST } from './azure-api-version.allowlist';

const TEN_DIGIT_CID = /^\d{10}$/;

/**
 * cron 字串驗證（M11-R3）：以 `cron-parser`（= BullMQ repeatable job 內部同一 parser）解析——無法解析 /
 * 越界（如 `60 3 * * *`）/ 空白 → **fail-fast**（NFR-5），避免無效 cron 逃過 env 驗證 → 啟動時
 * `upsertJobScheduler` 擲錯被 bootstrap best-effort catch 吞掉 → 排程刷新靜默停擺（AC-29.2）。
 */
const cronString = (): Joi.StringSchema =>
  Joi.string().custom((value: string, helpers) => {
    if (value.trim() === '') {
      return helpers.error('any.invalid');
    }
    try {
      parseExpression(value);
    } catch {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'cron');

/**
 * 環境變數驗證 schema（TC-19，fail-fast）。
 *
 * - 缺任一必填 → 啟動拋錯（`ConfigModule.forRoot({ validationSchema })`）。
 * - `AZURE_OPENAI_API_VERSION` 以 **allowlist 集合**比對（非字典序 `>=`，見 src/config/azure-api-version.allowlist.ts）。
 * - 運維可調參數（M0-R7）也納入驗證：給預設、限正整數/範圍，避免 `allowUnknown` 讓 typo/非數值
 *   靜默放行（NFR-5「env 缺值/錯值即 fail-fast」）。對映 Design §14。
 * - 仍未列出的 env key（PATH 等系統變數，以及尚未進場的 M5–M7 參數）由 `ConfigModule` 的
 *   `validationOptions.allowUnknown` 放行。
 */
export const validationSchema = Joi.object({
  // —— App ——
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  API_KEY: Joi.string().required(),
  // CORS 白名單（逗號分隔 origin；空＝不允許跨域）。credentials 模式必為反射式白名單（不可 '*'），NFR-14。
  ALLOWED_ORIGINS: Joi.string().allow('').default(''),
  // SSE heartbeat 事件週期（毫秒），防 LB/proxy idle 切斷（FR-9 AC-9.6/9.7）；named event，非 : comment。
  SSE_HEARTBEAT_MS: Joi.number().integer().min(0).default(15000),
  // helmet 安全 header 開關（預設開；非 production 可關以便本機/特定測試），NFR-14。
  HELMET_ENABLED: Joi.boolean().default(true),
  // JSON body 上限（MB）；自 express 預設 100kb 提高（exact 模式大 seeds），逾此 → 413，NFR-14。
  // 預設 5（Design §14 config SSOT）；.env.test 刻意收窄為 1 以廉價驗 TC-58 邊界（見該檔註）。
  BODY_LIMIT_MB: Joi.number().positive().default(5),

  // —— Auth（M10，FR-24/NFR-15；密碼 argon2id 參數＝OWASP 下限，S7：參數過低＝弱雜湊 → 以 min 守底）——
  ARGON2_MEMORY_KIB: Joi.number().integer().min(19456).default(19456), // OWASP 下限 19 MiB
  ARGON2_TIME_COST: Joi.number().integer().min(2).default(2),
  ARGON2_PARALLELISM: Joi.number().integer().min(1).default(1),
  AUTH_MIN_PASSWORD_LEN: Joi.number().integer().min(10).default(10), // Design §14 / AC-24.1
  SESSION_SECRET: Joi.string().min(16).required(), // ★ redact；fail-fast（TC-63）
  SESSION_TTL_MS: Joi.number().integer().min(0).default(604800000), // 7 天（ms）
  SESSION_COOKIE_NAME: Joi.string().default('sid'),
  SESSION_COOKIE_SECURE: Joi.boolean().default(true), // 非 test 預設 true（S6；漏設即降級）
  SESSION_COOKIE_SAMESITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),
  LOG_LEVEL: Joi.string()
    .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent')
    .default('info'),

  // —— Google Ads（六項憑證）——
  GOOGLE_ADS_CLIENT_ID: Joi.string().required(),
  GOOGLE_ADS_CLIENT_SECRET: Joi.string().required(),
  GOOGLE_ADS_REFRESH_TOKEN: Joi.string().required(),
  GOOGLE_ADS_DEVELOPER_TOKEN: Joi.string().required(),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: Joi.string().pattern(TEN_DIGIT_CID).required(),
  GOOGLE_ADS_CUSTOMER_ID: Joi.string().pattern(TEN_DIGIT_CID).required(),
  // 每批 seed 硬上限 20（>20 → Google Ads InvalidArgument）；預設保守 15（Design §14、正確性單點）。
  GOOGLE_ADS_SEED_BATCH_SIZE: Joi.number().integer().min(1).max(20).default(15),
  GOOGLE_ADS_HISTORICAL_BATCH_SIZE: Joi.number().integer().min(1).max(10000).default(1000),
  GOOGLE_ADS_QPS: Joi.number().positive().default(1),
  // job 內 Ads 暫時性錯誤就地退避重試（與 BullMQ job-level JOB_ATTEMPTS 為兩個獨立維度；Design §11/§14）。
  GOOGLE_ADS_MAX_RETRIES: Joi.number().integer().min(0).default(5),
  GOOGLE_ADS_BACKOFF_BASE_MS: Joi.number().integer().min(0).default(5000),

  // —— Azure OpenAI ——
  AZURE_OPENAI_ENDPOINT: Joi.string().uri().required(),
  AZURE_OPENAI_API_KEY: Joi.string().required(),
  AZURE_OPENAI_DEPLOYMENT: Joi.string().required(),
  AZURE_OPENAI_API_VERSION: Joi.string()
    .valid(...AZURE_OPENAI_API_VERSION_ALLOWLIST)
    .required(),
  AZURE_OPENAI_MAX_RETRIES: Joi.number().integer().min(0).default(5),
  LLM_BATCH_SIZE: Joi.number().integer().min(1).default(30),
  LLM_CONCURRENCY: Joi.number().integer().min(1).default(6),

  // —— Redis / Postgres ——
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),

  // —— Cache / Queue 運維參數（TTL 一律毫秒；Design §14）——
  CACHE_TTL_METRICS_MS: Joi.number().integer().min(0).default(1814400000),
  CACHE_TTL_INTENT_MS: Joi.number().integer().min(0).default(5184000000),
  // intent 快取 namespace 版本（schema/prompt 變更皆 bump 此單一版本 → 整批失效；FR-10）。
  // 限 `v\d+`（如 v1/v2）：避免含 `:` 等字元注入額外 key 段、並 fail-fast 擋拼錯。
  INTENT_SCHEMA_VERSION: Joi.string()
    .pattern(/^v\d+$/)
    .default('v1'),
  // per-view AI 洞察快取 namespace 版本（bump 整批失效，AC-32.2；限 `v\d+`，同 INTENT_SCHEMA_VERSION）。
  AI_INSIGHT_SCHEMA_VERSION: Joi.string()
    .pattern(/^v\d+$/)
    .default('v1'),
  // per-view AI 洞察快取 TTL（毫秒，預設 60 天）；快取內容綁不可變 snapshot + 固定 filters，TTL 僅為記憶體逐出。
  CACHE_TTL_AI_INSIGHT_MS: Joi.number().integer().min(0).default(5184000000),
  // 購買歷程分類快取 namespace 版本（bump 整批失效，AC-33.3；schema 或 prompt 變更皆 bump；限 `v\d+`，同 INTENT_SCHEMA_VERSION）。
  JOURNEY_SCHEMA_VERSION: Joi.string()
    .pattern(/^v\d+$/)
    .default('v1'),
  // 購買歷程分類 Redis 快取 TTL（毫秒，預設 60 天）；快取綁 normalizedText + 版本，TTL 僅記憶體逐出。
  CACHE_TTL_JOURNEY_MS: Joi.number().integer().min(0).default(5184000000),
  // 購買歷程每 prompt 關鍵字數（沿用 intent 批量慣例，預設 30；並發沿用 LLM_CONCURRENCY，AC-33.1）。
  JOURNEY_LLM_BATCH_SIZE: Joi.number().integer().min(1).default(30),
  // 購買歷程 async job 單次分類的關鍵字數上限（成本護欄，預設 5000；超過→413，#484 / AC-33.6）。
  JOURNEY_MAX_KEYWORDS: Joi.number().integer().min(1).default(5000),
  // 購買歷程 worker 並發（BullMQ；預設 3，同 topics）。
  JOURNEY_QUEUE_CONCURRENCY: Joi.number().integer().min(1).default(3),
  // 自訂分類標籤數上限（動態 enum 大小，AC-34.1；預設 12）。
  CUSTOM_CLASSIFY_MAX_LABELS: Joi.number().integer().min(1).default(12),
  // 自訂分類 schema/快取版本（限 `v\d+`，同 INTENT_SCHEMA_VERSION；階段二歸類快取用，FR-34）。
  CUSTOM_CLASSIFY_SCHEMA_VERSION: Joi.string()
    .pattern(/^v\d+$/)
    .default('v1'),
  // 自訂分類每 prompt 關鍵字數（沿用 intent/journey 批量慣例，預設 30；並發沿用 LLM_CONCURRENCY，FR-34）。
  CUSTOM_CLASSIFY_LLM_BATCH_SIZE: Joi.number().integer().min(1).default(30),
  // 自訂分類 async job 單次歸類的關鍵字數上限（成本護欄，預設 5000；超過→413，FR-34）。
  CUSTOM_CLASSIFY_MAX_KEYWORDS: Joi.number().integer().min(1).default(5000),
  // 自訂分類 worker 並發（BullMQ；預設 3，同 topics/journey）。
  CUSTOM_CLASSIFY_QUEUE_CONCURRENCY: Joi.number().integer().min(1).default(3),
  // 自訂分類階段二歸類 Redis 快取 TTL（毫秒，預設 60 天）；快取綁 normalizedText + 版本，TTL 僅記憶體逐出。
  CACHE_TTL_CUSTOM_CLASSIFY_MS: Joi.number().integer().min(1).default(5184000000),
  WORKER_CONCURRENCY: Joi.number().integer().min(1).default(5),
  JOB_ATTEMPTS: Joi.number().integer().min(1).default(5),
  JOB_BACKOFF_MS: Joi.number().integer().min(0).default(3000),
  JOB_BACKOFF_JITTER: Joi.number().min(0).max(1).default(0.2),
  IDEMP_TTL_MS: Joi.number().integer().min(0).default(86400000),
  JOB_TTL_MS: Joi.number().integer().min(0).default(259200000),
  // —— 讀取層/彙整上限（Design §6.5/§9.3）——
  QUERY_MAX_PAGE_SIZE: Joi.number().integer().min(1).default(200),
  AGG_MAX_BUCKETS: Joi.number().integer().min(1).default(200),
  AGG_MAX_GROUPS: Joi.number().integer().min(1).max(5000).default(1000),

  // —— Embeddings（M8，Design §14）——
  // ⚠ 固定 **3072**（M8-R1）：keyword_embeddings 欄為 `halfvec(3072)`，非 3072 的維度會在 pgvector INSERT
  // 時才失敗（fake configurability）。故 fail-fast 在**開機**即擋（`valid(3072)`）而非延到寫入。截短 768/1536
  // 為未來增強——需另開 migration 改 `vector` 型別 + 手動 normalize，屆時再放寬此 allowlist（Design §14）。
  GEMINI_EMBEDDING_DIM: Joi.number().integer().valid(3072).default(3072),
  GEMINI_API_KEY: Joi.string().required(), // ★ redact（NFR-5）；@google/genai client 憑證
  GEMINI_EMBEDDING_MODEL: Joi.string().default('gemini-embedding-001'), // 鎖此 id
  GEMINI_EMBEDDING_TASK_TYPE: Joi.string().default('CLUSTERING'),
  GEMINI_EMBEDDING_BATCH_SIZE: Joi.number().integer().min(1).max(500).default(100), // >500 有順序 bug
  // 批次並發（p-limit）+ 429/5xx/傳輸層退避（Number.isFinite 由 Joi min 保證；避免 NaN → 無限迴圈，M8-R1 review）。
  GEMINI_EMBEDDING_CONCURRENCY: Joi.number().integer().min(1).default(4),
  GEMINI_EMBEDDING_MAX_RETRIES: Joi.number().integer().min(0).default(5),
  GEMINI_EMBEDDING_BACKOFF_BASE_MS: Joi.number().integer().min(0).default(500),
  // embedding 快取 namespace 版本（schema/prompt/輸入組裝變更即 bump → 整批失效；限 `v\d+`，同 INTENT_SCHEMA_VERSION）。
  EMBEDDING_SCHEMA_VERSION: Joi.string()
    .pattern(/^v\d+$/)
    .default('v1'),
  CACHE_TTL_EMBEDDING_MS: Joi.number().integer().min(0).default(5184000000), // 60 天（ms）

  // —— SERP（M8，Design §14/§16；MVP 預設關閉→純文字 embedding）——
  SERP_ENABLED: Joi.boolean().default(false),
  // 供應商/憑證/端點：僅 SERP_ENABLED 時必填（Joi conditional；關閉時省設定即可跑純關鍵字）。
  SERP_PROVIDER: Joi.string()
    .valid('serpapi', 'serper')
    .when('SERP_ENABLED', { is: true, then: Joi.required(), otherwise: Joi.optional() })
    .default('serpapi'),
  SERP_API_KEY: Joi.string().when('SERP_ENABLED', { is: true, then: Joi.required() }), // ★ redact（NFR-5）
  SERP_API_URL: Joi.string().uri().when('SERP_ENABLED', { is: true, then: Joi.required() }),
  SERP_TOP_N: Joi.number().integer().min(1).default(5),
  SERP_FRESHNESS_DAYS: Joi.number().integer().min(0).default(30), // 窗內重用 serp_fetches、不重抓
  SERP_RETENTION_DAYS: Joi.number().integer().min(1).optional(), // 未設＝保留全部歷史（SERP-over-time）
  SERP_MAX_RETRIES: Joi.number().integer().min(0).default(3), // 429/5xx/傳輸層退避重試上限
  SERP_BACKOFF_BASE_MS: Joi.number().integer().min(0).default(500), // 退避起始延遲（2^(n-1)*base）

  // —— Clustering（M8，Design §16；HTTP → Python cluster-service）——
  // topics 分群一律經此服務（無 enable 旗標）→ URL 必填、開機即 fail-fast（缺值不留到 job 才炸）。
  CLUSTER_SERVICE_URL: Joi.string().uri().required(),
  CLUSTER_SERVICE_TIMEOUT_MS: Joi.number().integer().min(0).default(90000), // CPU-bound UMAP+HDBSCAN 需長 timeout
  CLUSTER_SERVICE_RETRIES: Joi.number().integer().min(0).default(2), // 逾時/5xx/傳輸層退避重試上限（達上限 → partial）
  CLUSTER_SERVICE_BACKOFF_BASE_MS: Joi.number().integer().min(0).default(1000), // 退避起始延遲（2^(n-1)*base）

  // —— Topics（M8，Design §14/§16；群命名複用 Azure LLM）——
  TOPIC_LLM_BATCH_CLUSTERS: Joi.number().integer().min(1).default(20), // 每批送 LLM 命名的群數
  // 命名 prompt / json_schema 版本（bump → 下游快取/紀錄失效；限 `v\d+`，同 INTENT_SCHEMA_VERSION）。
  TOPIC_PROMPT_VERSION: Joi.string()
    .pattern(/^v\d+$/)
    .default('v1'),
  TOPIC_SCHEMA_VERSION: Joi.string()
    .pattern(/^v\d+$/)
    .default('v1'),
  TOPICS_QUEUE_CONCURRENCY: Joi.number().integer().min(1).default(3), // topics BullMQ worker 並發

  // —— Tracking（M11，FR-28/29；Design §14/§17.3）——
  // 每 owner 清單數上限（AC-28.7）；建立時達上限 → 409（保護每月 Ads 配額，NFR-16）。
  TRACKING_MAX_LISTS: Joi.number().integer().min(1).default(50),
  // 每清單成員數上限（AC-28.7）；達上限再加入 → 409（保護每月 Ads 配額，NFR-16）。其餘 TRACKING_* 由 T11.8 補齊。
  TRACKING_MAX_MEMBERS_PER_LIST: Joi.number().integer().min(1).default(500),
  // 加成員單批 items 上限（NFR-16 DoS 前置守門）；超過 → 400，先於任何 DB 展開（比照 INGEST_BATCH_MAX）。
  TRACKING_MAX_ITEMS_PER_REQUEST: Joi.number().integer().min(1).default(500),
  // 搜量刷新回填月數（AC-29.1；預設 12＝Ads 原生窗）；VolumeSnapshot.monthlyVolumes 裁切至最近 N 個月。
  TRACKING_BACKFILL_MONTHS: Joi.number().integer().min(1).default(12),
  // 排程刷新 repeatable job cron（AC-29.2；預設每日一次）；月粒度指標日間多半不變＋store-on-change dedup。
  TRACKING_REFRESH_CRON: cronString().default('0 3 * * *'),
  // 刪清單時保留時序（AC-28.2；預設 false＝連帶刪除，VolumeSnapshot 無 FK cascade → service 顯式 deleteMany）。
  TRACKING_KEEP_SERIES_ON_DELETE: Joi.boolean().default(false),
});
