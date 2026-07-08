import type { MessageEvent } from '@nestjs/common';
import { Subject } from 'rxjs';
import { HEARTBEAT_EVENT, withHeartbeat } from './sse-heartbeat';

/**
 * TC-57（FR-9 / AC-9.6/9.7）：SSE heartbeat 共用運算子。fake timers 確保時序決定性
 * （SSE 時序整合測易 flaky → 測運算子本身）。heartbeat = named `heartbeat` 事件（非 `:` comment，
 * 見 AC-9.6 spec-first 校正）；不觸發來源終止、來源終態一併停止。
 */
const HB = 15000;

describe('TC-57: withHeartbeat（SSE heartbeat）', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('閒置來源每 intervalMs 發 heartbeat 事件、不觸發來源終止；來源事件穿透', () => {
    const source = new Subject<MessageEvent>();
    const seen: MessageEvent[] = [];
    let completed = false;
    const sub = withHeartbeat(source.asObservable(), HB).subscribe({
      next: (e) => seen.push(e),
      complete: () => {
        completed = true;
      },
    });

    jest.advanceTimersByTime(HB);
    expect(seen).toEqual([HEARTBEAT_EVENT]);
    jest.advanceTimersByTime(HB);
    expect(seen).toEqual([HEARTBEAT_EVENT, HEARTBEAT_EVENT]);

    // 真實事件穿透、與 heartbeat 交錯，來源仍活著（未 complete）。
    const progress: MessageEvent = { type: 'progress', data: { percent: 10 } };
    source.next(progress);
    expect(seen[seen.length - 1]).toBe(progress);
    expect(completed).toBe(false);

    sub.unsubscribe();
  });

  it('來源 complete（終態）→ heartbeat 停止、下游 complete', () => {
    const source = new Subject<MessageEvent>();
    const seen: MessageEvent[] = [];
    let completed = false;
    withHeartbeat(source.asObservable(), HB).subscribe({
      next: (e) => seen.push(e),
      complete: () => {
        completed = true;
      },
    });

    jest.advanceTimersByTime(HB); // 1 次 heartbeat
    source.complete();
    expect(completed).toBe(true);

    jest.advanceTimersByTime(HB * 4); // 終態後不得再發 heartbeat（timer 已清）
    expect(seen).toEqual([HEARTBEAT_EVENT]);
  });

  it('來源 error → heartbeat 停止、error 傳遞', () => {
    const source = new Subject<MessageEvent>();
    const seen: MessageEvent[] = [];
    let errored = false;
    withHeartbeat(source.asObservable(), HB).subscribe({
      next: (e) => seen.push(e),
      error: () => {
        errored = true;
      },
    });

    source.error(new Error('boom'));
    expect(errored).toBe(true);
    jest.advanceTimersByTime(HB * 4);
    expect(seen).toEqual([]);
  });

  it('下游 unsubscribe → 清除 timer（無洩漏、無殘留 heartbeat）', () => {
    const source = new Subject<MessageEvent>();
    const seen: MessageEvent[] = [];
    const sub = withHeartbeat(source.asObservable(), HB).subscribe((e) => seen.push(e));

    sub.unsubscribe();
    jest.advanceTimersByTime(HB * 4);
    expect(seen).toEqual([]);
  });
});
