import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * SSE 保活 heartbeat 事件（FR-9/AC-9.6）。**named event（非 `:` comment）**——NestJS `@Sse` 的 `SseStream`
 * serializer 無 `:` comment 支援，故以獨立事件名 + 空 data 實現：wire 為 `event: heartbeat\nid:N\n\n`，
 * 因 data 空 EventSource 不 dispatch message、前端亦不監聽此事件名 → 不干擾 progress/completed/failed。
 */
export const HEARTBEAT_EVENT: MessageEvent = { type: 'heartbeat', data: '' };

/**
 * 在 SSE Observable 上疊加週期性 heartbeat（防 LB/proxy idle 切斷，AC-9.6/9.7）：每 `intervalMs` 發一則
 * {@link HEARTBEAT_EVENT}；來源 complete/error（終態）或下游 unsubscribe 時 `clearInterval` 一併停止。
 * heartbeat 不進來源的 `takeWhile(terminal)` 判定。keyword-analysis 與 topics 兩流共用此運算子。
 */
export function withHeartbeat(
  source$: Observable<MessageEvent>,
  intervalMs: number,
): Observable<MessageEvent> {
  return new Observable<MessageEvent>((subscriber) => {
    const timer = setInterval(() => subscriber.next(HEARTBEAT_EVENT), intervalMs);
    const sub = source$.subscribe({
      next: (event) => subscriber.next(event),
      error: (err: unknown) => {
        clearInterval(timer);
        subscriber.error(err);
      },
      complete: () => {
        clearInterval(timer);
        subscriber.complete();
      },
    });
    return () => {
      clearInterval(timer);
      sub.unsubscribe();
    };
  });
}
