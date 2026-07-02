/** BullMQ queue 名稱（DI token 與 processor/producer 共用單一來源）。 */
export const KEYWORD_ANALYSIS_QUEUE = 'keyword-analysis';

/** 主題分群 BullMQ queue 名稱（T8.9；獨立於 keyword-analysis）。 */
export const TOPICS_QUEUE = 'topics';

/** BullMQ 連線的 DI token（正式為 IORedis、測試可 override 成 ioredis-mock）。 */
export const BULL_CONNECTION = 'BullConnection';
