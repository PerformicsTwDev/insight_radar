import type { ConfigType } from '@nestjs/config';
import { firstValueFrom, of, Subject, toArray } from 'rxjs';
import type { AuthenticatedUser } from '../common/authenticated-user';
import type { appConfig } from '../config/app.config';
import type { JobEvent, JobEventsService } from '../queue/job-events.service';
import { AiSearchController } from './ai-search.controller';
import type { CreateAiSearchAnalysisDto } from './ai-search.dto';
import type { AiSearchRunService } from './ai-search-run.service';

const ACTOR: AuthenticatedUser = { kind: 'apiKey' };
const CONFIG = { sseHeartbeatMs: 100000 } as unknown as ConfigType<typeof appConfig>;
const DTO: CreateAiSearchAnalysisDto = { keywords: ['a'], channels: ['chatGpt'] };

interface MakeOpts {
  getRunRef?: jest.Mock;
  forJob?: (runId: string) => ReturnType<JobEventsService['forJob']>;
}
function make(opts: MakeOpts = {}) {
  const create = jest.fn().mockResolvedValue({ jobId: 'run-1' });
  const getStatus = jest.fn().mockResolvedValue({
    jobId: 'run-1',
    status: 'partial',
    progress: {},
    captureCount: 2,
  });
  const getRunRef = opts.getRunRef ?? jest.fn().mockResolvedValue(null);
  const service = { create, getStatus, getRunRef } as unknown as AiSearchRunService;
  const events = { forJob: opts.forJob ?? (() => of()) } as unknown as JobEventsService;
  const controller = new AiSearchController(service, events, CONFIG);
  return { controller, create, getStatus, getRunRef };
}

describe('AiSearchController (T14.6 / FR-41 / AC-41.x)', () => {
  it('delegates create with the current actor', async () => {
    const { controller, create } = make();
    expect(await controller.create(DTO, ACTOR)).toEqual({ jobId: 'run-1' });
    expect(create).toHaveBeenCalledWith(DTO, ACTOR);
  });

  it('delegates getStatus with the current actor', async () => {
    const { controller, getStatus } = make();
    const out = await controller.getStatus('run-1', ACTOR);
    expect(out).toMatchObject({ jobId: 'run-1', status: 'partial', captureCount: 2 });
    expect(getStatus).toHaveBeenCalledWith('run-1', ACTOR);
  });

  describe('SSE stream', () => {
    it('emits an empty stream when there is no run (unknown/cross-owner)', async () => {
      const { controller } = make({ getRunRef: jest.fn().mockResolvedValue(null) });
      const events = await controller.stream('run-1', ACTOR);
      expect(await firstValueFrom(events.pipe(toArray()))).toEqual([]);
    });

    it('emits a terminal snapshot (completed) without subscribing to forJob', async () => {
      const forJob = jest.fn();
      const { controller } = make({
        getRunRef: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'completed' }),
        forJob: forJob as unknown as MakeOpts['forJob'],
      });
      const events = await controller.stream('run-1', ACTOR);
      expect(await firstValueFrom(events.pipe(toArray()))).toEqual([
        { type: 'completed', data: { runId: 'run-1', status: 'completed' } },
      ]);
      expect(forJob).not.toHaveBeenCalled();
    });

    it('maps a terminal partial to a completed snapshot with the partial status', async () => {
      const { controller } = make({
        getRunRef: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'partial' }),
      });
      const events = await controller.stream('run-1', ACTOR);
      expect(await firstValueFrom(events.pipe(toArray()))).toEqual([
        { type: 'completed', data: { runId: 'run-1', status: 'partial' } },
      ]);
    });

    it('maps a terminal failed status to a failed snapshot', async () => {
      const { controller } = make({
        getRunRef: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'failed' }),
      });
      const events = await controller.stream('run-1', ACTOR);
      expect(await firstValueFrom(events.pipe(toArray()))).toEqual([
        { type: 'failed', data: { error: 'failed' } },
      ]);
    });

    it('subscribes to forJob for a live run and completes inclusively on a terminal event', async () => {
      const subject = new Subject<JobEvent>();
      const { controller } = make({
        getRunRef: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'running' }),
        forJob: () => subject.asObservable(),
      });
      const events = await controller.stream('run-1', ACTOR);
      const collected = firstValueFrom(events.pipe(toArray()));
      subject.next({ type: 'progress', data: { percent: 40 } });
      subject.next({ type: 'completed', data: { runId: 'run-1' } });
      expect((await collected).map((e) => e.type)).toEqual(['progress', 'completed']);
    });

    it('maps a live failed event to a {error} frame and completes inclusively', async () => {
      const subject = new Subject<JobEvent>();
      const { controller } = make({
        getRunRef: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'running' }),
        forJob: () => subject.asObservable(),
      });
      const events = await controller.stream('run-1', ACTOR);
      const collected = firstValueFrom(events.pipe(toArray()));
      subject.next({ type: 'failed', data: 'boom' });
      expect(await collected).toEqual([{ type: 'failed', data: { error: 'boom' } }]);
    });

    it('degrades to an empty stream when getRunRef throws (SSE must not reject)', async () => {
      const { controller } = make({ getRunRef: jest.fn().mockRejectedValue(new Error('boom')) });
      const events = await controller.stream('run-1', ACTOR);
      expect(await firstValueFrom(events.pipe(toArray()))).toEqual([]);
    });
  });
});
