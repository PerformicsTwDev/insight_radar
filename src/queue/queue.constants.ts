/** BullMQ queue 名稱（DI token 與 processor/producer 共用單一來源）。 */
export const KEYWORD_ANALYSIS_QUEUE = 'keyword-analysis';

/** BullMQ 連線的 DI token（正式為 IORedis、測試可 override 成 ioredis-mock）。 */
export const BULL_CONNECTION = 'BullConnection';
