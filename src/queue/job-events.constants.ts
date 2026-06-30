/** 單一 `QueueEvents('keyword-analysis')` 的 DI token（正式為 bullmq QueueEvents、測試可 override fake）。 */
export const JOB_QUEUE_EVENTS = 'JobQueueEvents';

/** QueueEvents 專用阻塞式 Redis 連線的 DI token（由 lifecycle 在 shutdown 收回，防洩漏/Jest hang）。 */
export const JOB_EVENTS_CONNECTION = 'JobEventsConnection';
