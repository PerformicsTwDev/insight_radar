/** topics `QueueEvents` 橋接後的 SSE 服務 DI token（= 一個複用 `JobEventsService` 的實例，綁 topics queue）。 */
export const TOPIC_JOB_EVENTS = 'TopicJobEvents';

/** 單一 `QueueEvents('topics')` 的 DI token（正式為 bullmq QueueEvents、測試可 override fake）。 */
export const TOPIC_QUEUE_EVENTS = 'TopicQueueEvents';

/** topics QueueEvents 專用阻塞式 Redis 連線的 DI token（由 lifecycle 在 shutdown 收回，防洩漏/Jest hang）。 */
export const TOPIC_JOB_EVENTS_CONNECTION = 'TopicJobEventsConnection';
