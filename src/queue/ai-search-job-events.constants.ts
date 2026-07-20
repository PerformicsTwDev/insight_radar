/** ai-search `QueueEvents` 橋接後的 SSE 服務 DI token（= 一個複用 `JobEventsService` 的實例，綁 ai-search queue）。 */
export const AI_SEARCH_JOB_EVENTS = 'AiSearchJobEvents';

/** 單一 `QueueEvents('ai-search')` 的 DI token（正式為 bullmq QueueEvents、測試可 override fake）。 */
export const AI_SEARCH_QUEUE_EVENTS = 'AiSearchQueueEvents';

/** ai-search QueueEvents 專用阻塞式 Redis 連線的 DI token（由 lifecycle 在 shutdown 收回，防洩漏/Jest hang）。 */
export const AI_SEARCH_JOB_EVENTS_CONNECTION = 'AiSearchJobEventsConnection';
