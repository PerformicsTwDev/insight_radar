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
    qe.trigger('completed', { jobId: 'b-2', returnvalue: { count: 5 } });
    qe.trigger('progress', { jobId: 'a-1', data: { phase: 'intent', percent: 100 } });

    expect(a).toEqual([
      { type: 'progress', data: { phase: 'fetch', percent: 40 } },
      { type: 'progress', data: { phase: 'intent', percent: 100 } },
    ]);
    expect(b).toEqual([{ type: 'completed', data: { count: 5 } }]); // 只收自己 job 的事件
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

  it('does not cross-deliver: a completed on one job leaves another job open', () => {
    const { qe, service } = setup();
    let aCompleted = false;
    service.forJob('a-1').subscribe({
      complete: () => {
        aCompleted = true;
      },
    });
    qe.trigger('completed', { jobId: 'b-2', returnvalue: { count: 1 } });
    expect(aCompleted).toBe(false);
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
