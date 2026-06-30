import { Logger, NotFoundException, type MessageEvent } from '@nestjs/common';
import { isObservable, Subject } from 'rxjs';
import { KeywordAnalysisController } from './keyword-analysis.controller';
import type { JobEvent, JobEventsService } from '../queue/job-events.service';
import type {
  AnalysisStatus,
  AnalysisStatusResponse,
  KeywordAnalysisService,
} from './keyword-analysis.service';

function statusResponse(status: AnalysisStatus): AnalysisStatusResponse {
  return {
    status,
    progress: { phase: status === 'queued' ? 'queued' : 'running', percent: 50 },
    result: { resultSnapshotId: null, count: null },
  };
}

function buildController(status: AnalysisStatusResponse | 'notfound' | 'error') {
  const subjects = new Map<string, Subject<JobEvent>>();
  const forJob = jest.fn((id: string) => {
    let subject = subjects.get(id);
    if (!subject) {
      subject = new Subject<JobEvent>();
      subjects.set(id, subject);
    }
    return subject.asObservable();
  });
  const events = { forJob } as unknown as JobEventsService;
  const getStatus = jest.fn((_id: string) => {
    if (status === 'notfound') return Promise.reject(new NotFoundException());
    if (status === 'error') return Promise.reject(new Error('db down'));
    return Promise.resolve(status);
  });
  const service = { getStatus } as unknown as KeywordAnalysisService;
  const controller = new KeywordAnalysisController(service, events);
  return { controller, subjects, forJob };
}

function collect(obs: import('rxjs').Observable<MessageEvent>) {
  const events: MessageEvent[] = [];
  let completed = false;
  obs.subscribe({ next: (e) => events.push(e), complete: () => (completed = true) });
  return { events, isDone: () => completed };
}

describe('KeywordAnalysisController @Sse stream (T3.9 / TC-18)', () => {
  it('maps forJob events to MessageEvents (event=type, data=payload, §6.3) and completes on completed', async () => {
    const { controller, subjects } = buildController(statusResponse('running'));
    const obs = await controller.stream('a-1');
    expect(isObservable(obs)).toBe(true);

    const { events, isDone } = collect(obs);
    const subject = subjects.get('a-1')!;
    subject.next({ type: 'progress', data: { phase: 'fetch', percent: 40 } });
    subject.next({ type: 'completed', data: { count: 3 } });
    subject.next({ type: 'progress', data: { phase: 'x', percent: 99 } }); // 終結後不應收到

    expect(events).toEqual([
      { type: 'progress', data: { phase: 'fetch', percent: 40 } },
      { type: 'completed', data: { count: 3 } },
    ]);
    expect(isDone()).toBe(true);
  });

  it('wraps a failed reason as {error} and completes (takeWhile inclusive)', async () => {
    const { controller, subjects } = buildController(statusResponse('running'));
    const obs = await controller.stream('a-1');
    const { events, isDone } = collect(obs);
    subjects.get('a-1')!.next({ type: 'failed', data: 'boom' });
    expect(events).toEqual([{ type: 'failed', data: { error: 'boom' } }]);
    expect(isDone()).toBe(true);
  });

  it('isolates jobs: two clients on the same job both receive; a different job receives nothing', async () => {
    const { controller, subjects } = buildController(statusResponse('running'));
    const a1 = collect(await controller.stream('a-1'));
    const a2 = collect(await controller.stream('a-1')); // 同 job 第二個 client
    const b1 = collect(await controller.stream('b-2')); // 不同 job

    subjects.get('a-1')!.next({ type: 'progress', data: { percent: 10 } });

    expect(a1.events).toHaveLength(1);
    expect(a2.events).toHaveLength(1); // 同 job 多 client 皆收
    expect(b1.events).toHaveLength(0); // 不同 job 不收
  });

  it('short-circuits an already-completed job to a §6.3 completed snapshot + complete', async () => {
    const { controller, subjects, forJob } = buildController(statusResponse('completed'));
    const obs = await controller.stream('done-1');
    const { events, isDone } = collect(obs);

    expect(events).toEqual([{ type: 'completed', data: { resultSnapshotId: null, count: null } }]);
    expect(isDone()).toBe(true);
    expect(forJob).not.toHaveBeenCalled(); // 未開 forJob 串流
    expect(subjects.has('done-1')).toBe(false);
  });

  it('short-circuits a failed/canceled job to a §6.3 failed snapshot', async () => {
    const { controller } = buildController(statusResponse('canceled'));
    const obs = await controller.stream('cx');
    const { events, isDone } = collect(obs);
    expect(events).toEqual([{ type: 'failed', data: { error: 'canceled' } }]);
    expect(isDone()).toBe(true);
  });

  it('returns an empty completing stream for an unknown id (GET owns the 404)', async () => {
    const { controller, forJob } = buildController('notfound');
    const obs = await controller.stream('ghost');
    const { events, isDone } = collect(obs);
    expect(events).toEqual([]);
    expect(isDone()).toBe(true);
    expect(forJob).not.toHaveBeenCalled();
  });

  it('degrades an unexpected (non-NotFound) status error to an empty stream + logs it (no hang/crash)', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { controller, forJob } = buildController('error');
    const obs = await controller.stream('x'); // resolves（不 reject → 不 hang/不殺 process）
    const { events, isDone } = collect(obs);
    expect(events).toEqual([]);
    expect(isDone()).toBe(true);
    expect(forJob).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1); // bug 由日誌可見（NFR-6）
    logSpy.mockRestore();
  });
});
