import type { MessageEvent } from '@nestjs/common';
import type { JobEvent } from '../queue/job-events.service';

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
