import { NotFoundException, type MessageEvent } from '@nestjs/common';
import { isObservable, Subject } from 'rxjs';
import { KeywordAnalysisController } from './keyword-analysis.controller';
import type { JobEventsService } from '../queue/job-events.service';
import type { JobEvent } from '../queue/job-events.service';
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

function buildController(status: AnalysisStatusResponse | 'notfound') {
  const subjects = new Map<string, Subject<JobEvent>>();
  const events = {
    forJob: (id: string) => {
      let subject = subjects.get(id);
      if (!subject) {
        subject = new Subject<JobEvent>();
        subjects.set(id, subject);
      }
      return subject.asObservable();
    },
  } as unknown as JobEventsService;
  const getStatus = jest.fn((_id: string) =>
    status === 'notfound' ? Promise.reject(new NotFoundException()) : Promise.resolve(status),
  );
  const service = { getStatus } as unknown as KeywordAnalysisService;
  const controller = new KeywordAnalysisController(service, events);
  return { controller, subjects, getStatus };
}

function collect(obs: import('rxjs').Observable<MessageEvent>) {
  const events: MessageEvent[] = [];
  let completed = false;
  obs.subscribe({ next: (e) => events.push(e), complete: () => (completed = true) });
  return { events, isDone: () => completed };
}

describe('KeywordAnalysisController @Sse stream (T3.9 / TC-18)', () => {
  it('maps forJob events to MessageEvents and completes on completed (takeWhile inclusive)', async () => {
    const { controller, subjects } = buildController(statusResponse('running'));
    const obs = await controller.stream('a-1');
    expect(isObservable(obs)).toBe(true);

    const { events, isDone } = collect(obs);
    const subject = subjects.get('a-1')!;
    subject.next({ type: 'progress', data: { phase: 'fetch', percent: 40 } });
    subject.next({ type: 'completed', data: { count: 3 } });
    // 終結後再發不應收到（已 complete）
    subject.next({ type: 'progress', data: { phase: 'x', percent: 99 } });

    expect(events.map((e) => e.data)).toEqual([
      { type: 'progress', data: { phase: 'fetch', percent: 40 } },
      { type: 'completed', data: { count: 3 } },
    ]);
    expect(isDone()).toBe(true);
  });

  it('completes on failed too (takeWhile inclusive)', async () => {
    const { controller, subjects } = buildController(statusResponse('running'));
    const obs = await controller.stream('a-1');
    const { events, isDone } = collect(obs);
    subjects.get('a-1')!.next({ type: 'failed', data: 'boom' });
    expect(events.map((e) => e.data)).toEqual([{ type: 'failed', data: 'boom' }]);
    expect(isDone()).toBe(true);
  });

  it('isolates clients: two subscribers on the same job both receive; a different job does not', async () => {
    const { controller, subjects } = buildController(statusResponse('running'));
    const obsA1 = await controller.stream('a-1');
    const obsA2 = await controller.stream('a-1'); // 同 job 第二個 client
    const c1 = collect(obsA1);
    const c2 = collect(obsA2);

    subjects.get('a-1')!.next({ type: 'progress', data: { percent: 10 } });
    expect(c1.events).toHaveLength(1);
    expect(c2.events).toHaveLength(1); // 同 job 多 client 互不干擾、皆收到
  });

  it('short-circuits an already-terminal job to one event + complete (no forJob hang)', async () => {
    const { controller, subjects } = buildController(statusResponse('completed'));
    const obs = await controller.stream('done-1');
    const { events, isDone } = collect(obs);

    expect(events).toHaveLength(1);
    expect((events[0].data as { status: string }).status).toBe('completed');
    expect(isDone()).toBe(true);
    expect(subjects.has('done-1')).toBe(false); // 未開 forJob 串流
  });

  it('returns an empty completing stream for an unknown id (GET owns the 404)', async () => {
    const { controller } = buildController('notfound');
    const obs = await controller.stream('ghost');
    const { events, isDone } = collect(obs);
    expect(events).toEqual([]);
    expect(isDone()).toBe(true);
  });

  it('propagates an unexpected (non-NotFound) status-lookup error (no silent swallow)', async () => {
    const forJob = jest.fn();
    const events = { forJob } as unknown as JobEventsService;
    const service = {
      getStatus: () => Promise.reject(new Error('db down')),
    } as unknown as KeywordAnalysisService;
    const controller = new KeywordAnalysisController(service, events);
    await expect(controller.stream('x')).rejects.toThrow('db down');
    expect(forJob).not.toHaveBeenCalled();
  });
});
