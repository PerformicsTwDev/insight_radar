/** BullMQ queue 名稱（DI token 與 processor/producer 共用單一來源）。 */
export const KEYWORD_ANALYSIS_QUEUE = 'keyword-analysis';

/** 主題分群 BullMQ queue 名稱（T8.9；獨立於 keyword-analysis）。 */
export const TOPICS_QUEUE = 'topics';

/** 追蹤清單搜量刷新 BullMQ queue 名稱（T11.6；repeatable 排程刷新 + 手動即時刷新共用同一 queue/worker）。 */
export const TRACKING_REFRESH_QUEUE = 'tracking-refresh';

/** 購買歷程分類 BullMQ queue 名稱（T12.6；整批 snapshot LLM 貼標 async job）。 */
export const JOURNEY_QUEUE = 'journey';

/** 自訂分類階段二歸類 BullMQ queue 名稱（T12.8；整批 snapshot LLM 貼標 async job）。 */
export const CUSTOM_CLASSIFY_QUEUE = 'custom-classify';

/** AI Search 抓取 BullMQ queue 名稱（T14.6，FR-41；SerpAPI pull + extension push 合流 async job）。 */
export const AI_SEARCH_QUEUE = 'ai-search';

/** BullMQ 連線的 DI token（正式為 IORedis、測試可 override 成 ioredis-mock）。 */
export const BULL_CONNECTION = 'BullConnection';
