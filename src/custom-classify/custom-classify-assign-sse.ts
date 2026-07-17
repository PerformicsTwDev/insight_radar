import type { MessageEvent } from '@nestjs/common';
import { EMPTY, type Observable, of } from 'rxjs';
import { map, takeWhile } from 'rxjs/operators';
import { withHeartbeat } from '../common/sse-heartbeat';
import type { JobEvent, JobEventsService } from '../queue/job-events.service';

/**
 * 自訂分類階段二 SSE 進度串流的**純映射/決策邏輯**（T12.8，FR-34/AC-34.2）。刻意抽出至 gate 內純函式
 * （coverage-gate §4：把真實分支下放至可測純函式）——使 `CustomClassifyAssignController` 成**真**純委派 shell
 * （其 SSE 分支邏輯在此受測、留在 gate 內），controller 檔案的比照排除因此更名副其實。
 */

/** 事件是否為終態（completed/failed）——takeWhile inclusive 據此停止串流。 */
export function isTerminalEvent(event: JobEvent): boolean {
  return event.type === 'completed' || event.type === 'failed';
}

/** 即時事件 → `MessageEvent`（type=event 名、data=payload；failed 字串理由包成 `{error}`）。 */
export function toMessageEvent(event: JobEvent): MessageEvent {
  if (event.type === 'failed') {
    return { type: 'failed', data: { error: event.data } };
  }
  return { type: event.type, data: event.data as MessageEvent['data'] };
}

/** 已終態 run 的單筆快照事件：completed→completed（有結果，經 GET/query 取）；否則（failed）→failed。 */
export function terminalSnapshot(ref: { runId: string; status: string }): MessageEvent {
  if (ref.status === 'completed') {
    return { type: 'completed', data: { runId: ref.runId, status: ref.status } };
  }
  return { type: 'failed', data: { error: ref.status } };
}

/**
 * SSE 回應計畫（純決策）：無 run（含未知/他人/cid 不屬 :id）→ `empty`；已終態 → `terminal`（單筆快照）；
 * 進行中 → `live`（controller 據 `runId` 訂閱 `forJob`）。controller 只依此 discriminated union 物化 Observable。
 */
export type SseResponsePlan =
  { kind: 'empty' } | { kind: 'terminal'; event: MessageEvent } | { kind: 'live'; runId: string };

export function planSseResponse(
  ref: { runId: string; status: string } | null,
  terminalStatuses: ReadonlySet<string>,
): SseResponsePlan {
  if (!ref) {
    return { kind: 'empty' };
  }
  if (terminalStatuses.has(ref.status)) {
    return { kind: 'terminal', event: terminalSnapshot(ref) };
  }
  return { kind: 'live', runId: ref.runId };
}

/**
 * 依 {@link SseResponsePlan} 物化 SSE Observable：`empty`→`EMPTY`（NestJS SSE 對空串流即刻 complete、不 hang）；
 * `terminal`→單筆快照後 complete；`live`→訂閱 `forJob(runId)`，`takeWhile` inclusive 於終態事件後 complete、
 * 加 heartbeat。抽出至 gate 內（controller `stream()` 因此成**零分支**純委派）。`events` 只取 `forJob`（易以替身測）。
 */
export function materializeSsePlan(
  plan: SseResponsePlan,
  events: Pick<JobEventsService, 'forJob'>,
  heartbeatMs: number,
): Observable<MessageEvent> {
  if (plan.kind === 'empty') {
    return EMPTY;
  }
  if (plan.kind === 'terminal') {
    return of(plan.event);
  }
  const events$ = events.forJob(plan.runId).pipe(
    takeWhile((event) => !isTerminalEvent(event), true), // inclusive：發終態事件後才 complete
    map(toMessageEvent),
  );
  return withHeartbeat(events$, heartbeatMs);
}
