/** journey `QueueEvents` 橋接後的 SSE 服務 DI token（= 一個複用 `JobEventsService` 的實例，綁 journey queue）。 */
export const JOURNEY_JOB_EVENTS = 'JourneyJobEvents';

/** 單一 `QueueEvents('journey')` 的 DI token（正式為 bullmq QueueEvents、測試可 override fake）。 */
export const JOURNEY_QUEUE_EVENTS = 'JourneyQueueEvents';

/** journey QueueEvents 專用阻塞式 Redis 連線的 DI token（由 lifecycle 在 shutdown 收回，防洩漏/Jest hang）。 */
export const JOURNEY_JOB_EVENTS_CONNECTION = 'JourneyJobEventsConnection';
