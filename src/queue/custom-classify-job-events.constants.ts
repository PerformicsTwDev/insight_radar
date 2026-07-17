/** custom-classify `QueueEvents` 橋接後的 SSE 服務 DI token（= 一個複用 `JobEventsService` 的實例，綁 custom-classify queue）。 */
export const CUSTOM_CLASSIFY_JOB_EVENTS = 'CustomClassifyJobEvents';

/** 單一 `QueueEvents('custom-classify')` 的 DI token（正式為 bullmq QueueEvents、測試可 override fake）。 */
export const CUSTOM_CLASSIFY_QUEUE_EVENTS = 'CustomClassifyQueueEvents';

/** custom-classify QueueEvents 專用阻塞式 Redis 連線的 DI token（由 lifecycle 在 shutdown 收回，防洩漏/Jest hang）。 */
export const CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION = 'CustomClassifyJobEventsConnection';
