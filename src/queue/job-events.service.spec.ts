import { JobEventsService } from './job-events.service';
import type { JobEvent, QueueEventsLike } from './job-events.service';

/** 假 QueueEvents：記錄 listener、可手動觸發；模擬 BullMQ 的 EventEmitter 行為（不連真 Redis）。 */
class FakeQueueEvents implements QueueEventsLike {
  private readonly handlers = new Map<string, (args: unknown) => void>();
  public closed = false;
  on(event: string, listener: (args: unknown) => void): this {
    this.handlers.set(event, listener);
    return this;
  }
  trigger(event: string, args: unknown): void {
    this.handlers.get(event)?.(args);
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function setup() {
  const qe = new FakeQueueEvents();
  const service = new JobEventsService(qe);
  service.onModuleInit();
  return { qe, service };
}

describe('JobEventsService (T3.8 / TC-18 partial)', () => {
  it('routes progress/completed/failed to per-job subjects; forJob only sees its own job', () => {
    const { qe, service } = setup();
    const a: JobEvent[] = [];
    const b: JobEvent[] = [];
    service.forJob('a-1').subscribe({ next: (e) => a.push(e) });
    service.forJob('b-2').subscribe({ next: (e) => b.push(e) });

    qe.trigger('progress', { jobId: 'a-1', data: { phase: 'fetch', percent: 40 } });
    // BullMQ QueueEvents 把 returnvalue **序列化為字串** 帶在 stream 上 → 須 JSON.parse 還原。
    qe.trigger('completed', { jobId: 'b-2', returnvalue: JSON.stringify({ count: 5 }) });
    qe.trigger('progress', { jobId: 'a-1', data: { phase: 'intent', percent: 100 } });

    expect(a).toEqual([
      { type: 'progress', data: { phase: 'fetch', percent: 40 } },
      { type: 'progress', data: { phase: 'intent', percent: 100 } },
    ]);
    expect(b).toEqual([{ type: 'completed', data: { count: 5 } }]); // 還原成物件、只收自己 job
  });

  it('emits the terminal event then completes the stream on completed/failed', () => {
    const { qe, service } = setup();
    const events: JobEvent[] = [];
    let completed = false;
    service.forJob('a-1').subscribe({
      next: (e) => events.push(e),
      complete: () => {
        completed = true;
      },
    });

    qe.trigger('failed', { jobId: 'a-1', failedReason: 'boom' });

    expect(events).toEqual([{ type: 'failed', data: 'boom' }]);
    expect(completed).toBe(true);
  });

  it('forJob after a terminal event returns an already-completed stream (race/late subscribe, no hang)', () => {
    const { qe, service } = setup();
    // 終態事件先到（forJob 尚未呼叫）——模擬 SSE getStatus 與 forJob 之間 job 完成的 race。
    qe.trigger('completed', { jobId: 'a-1', returnvalue: JSON.stringify({ count: 2 }) });

    let completed = false;
    const events: JobEvent[] = [];
    service.forJob('a-1').subscribe({
      next: (e) => events.push(e),
      complete: () => (completed = true),
    });

    expect(completed).toBe(true); // 立即 complete（保留已完成 Subject）→ 不開永不完成的串流
    expect(events).toEqual([]); // Subject 不 replay next 值，只 replay 完成
  });

  it('does not cross-deliver: a completed on one job leaves another job open', () => {
    const { qe, service } = setup();
    let aCompleted = false;
    service.forJob('a-1').subscribe({
      complete: () => {
        aCompleted = true;
      },
    });
    qe.trigger('completed', { jobId: 'b-2', returnvalue: JSON.stringify({ count: 1 }) });
    expect(aCompleted).toBe(false);
  });

  it('passes empty/undefined and non-JSON returnvalue through unchanged (robust)', () => {
    const { qe, service } = setup();
    const a: JobEvent[] = [];
    const b: JobEvent[] = [];
    service.forJob('a-1').subscribe({ next: (e) => a.push(e) });
    service.forJob('b-2').subscribe({ next: (e) => b.push(e) });
    qe.trigger('completed', { jobId: 'a-1', returnvalue: undefined });
    qe.trigger('completed', { jobId: 'b-2', returnvalue: 'not-json{' }); // JSON.parse 失敗 → 原樣
    expect(a).toEqual([{ type: 'completed', data: undefined }]);
    expect(b).toEqual([{ type: 'completed', data: 'not-json{' }]);
  });

  it('evicts the oldest terminated subjects beyond the retention cap (bounded memory)', () => {
    const { qe, service } = setup();
    // 觸發超過保留上限（1024）的終態 job。
    for (let i = 0; i <= 1024; i += 1) {
      qe.trigger('completed', { jobId: `job-${i}`, returnvalue: JSON.stringify({ count: i }) });
    }
    // 最舊（job-0）已被 FIFO 驅逐 → late forJob 得到新的未完成串流（不立即 complete）。
    let job0Completed = false;
    service.forJob('job-0').subscribe({ complete: () => (job0Completed = true) });
    expect(job0Completed).toBe(false);
    // 最新（job-1024）仍保留 → late forJob 立即 complete。
    let lastCompleted = false;
    service.forJob('job-1024').subscribe({ complete: () => (lastCompleted = true) });
    expect(lastCompleted).toBe(true);
  });

  it('ignores events without a string jobId', () => {
    const { qe, service } = setup();
    const a: JobEvent[] = [];
    service.forJob('a-1').subscribe({ next: (e) => a.push(e) });
    qe.trigger('progress', { data: { percent: 10 } }); // 無 jobId
    expect(a).toEqual([]);
  });

  it('closes QueueEvents and completes open streams on destroy (no hang)', async () => {
    const { qe, service } = setup();
    let completed = false;
    service.forJob('a-1').subscribe({
      complete: () => {
        completed = true;
      },
    });
    await service.onModuleDestroy();
    expect(qe.closed).toBe(true);
    expect(completed).toBe(true);
  });
});
