import type { ConfigType } from '@nestjs/config';
import { firstValueFrom, of, Subject, toArray } from 'rxjs';
import type { AuthenticatedUser } from '../common/authenticated-user';
import type { appConfig } from '../config/app.config';
import type { JobEvent, JobEventsService } from '../queue/job-events.service';
import { JourneyController } from './journey.controller';
import type { JourneyRunService, JourneyStatusResponse } from './journey-run.service';

const ACTOR: AuthenticatedUser = { kind: 'apiKey' };
const CONFIG = { sseHeartbeatMs: 100000 } as unknown as ConfigType<typeof appConfig>;

interface MakeOpts {
  runRef?: { runId: string; status: string } | null;
  runRefError?: Error;
  status?: JourneyStatusResponse;
  forJob?: () => ReturnType<JobEventsService['forJob']>;
}
function make(opts: MakeOpts = {}) {
  const create = jest.fn(() => Promise.resolve({ journeyJobId: 'run-1' }));
  const getStatus = jest.fn(() =>
    Promise.resolve(
      opts.status ?? {
        journeyJobId: 'run-1',
        status: 'completed',
        progress: {},
        keywordCount: 3,
      },
    ),
  );
  const getRunRef = jest.fn(() =>
    opts.runRefError ? Promise.reject(opts.runRefError) : Promise.resolve(opts.runRef ?? null),
  );
  const service = { create, getStatus, getRunRef } as unknown as JourneyRunService;
  const forJob = jest.fn(opts.forJob ?? (() => of<JobEvent>()));
  const events = { forJob } as unknown as JobEventsService;
  const controller = new JourneyController(service, events, CONFIG);
  return { controller, create, getStatus, getRunRef, forJob };
}

describe('JourneyController (T12.6 / FR-33 / AC-33.6)', () => {
  it('delegates create with the current actor', async () => {
    const { controller, create } = make();
    expect(await controller.create('an-1', ACTOR)).toEqual({ journeyJobId: 'run-1' });
    expect(create).toHaveBeenCalledWith('an-1', ACTOR);
  });

  it('delegates getStatus with the current actor', async () => {
    const { controller, getStatus } = make();
    const out = await controller.getStatus('an-1', ACTOR);
    expect(out).toMatchObject({ journeyJobId: 'run-1', status: 'completed' });
    expect(getStatus).toHaveBeenCalledWith('an-1', ACTOR);
  });

  describe('SSE stream', () => {
    it('emits an empty stream when there is no run (unknown/cross-owner analysis)', async () => {
      const { controller } = make({ runRef: null });
      const events = await controller.stream('an-1', ACTOR);
      expect(await firstValueFrom(events.pipe(toArray()))).toEqual([]);
    });

    it('emits a terminal snapshot (completed) without subscribing to forJob', async () => {
      const { controller, forJob } = make({ runRef: { runId: 'run-1', status: 'completed' } });
      const events = await controller.stream('an-1', ACTOR);
      expect(await firstValueFrom(events.pipe(toArray()))).toEqual([
        { type: 'completed', data: { runId: 'run-1', status: 'completed' } },
      ]);
      expect(forJob).not.toHaveBeenCalled();
    });

    it('maps a terminal failed status to a failed snapshot', async () => {
      const { controller } = make({ runRef: { runId: 'run-1', status: 'failed' } });
      const events = await controller.stream('an-1', ACTOR);
      expect(await firstValueFrom(events.pipe(toArray()))).toEqual([
        { type: 'failed', data: { error: 'failed' } },
      ]);
    });

    it('subscribes to forJob for a live run and completes inclusively on a terminal event', async () => {
      const subject = new Subject<JobEvent>();
      const { controller } = make({
        runRef: { runId: 'run-1', status: 'running' },
        forJob: () => subject.asObservable(),
      });
      const events = await controller.stream('an-1', ACTOR);
      const collected = firstValueFrom(events.pipe(toArray()));
      subject.next({ type: 'progress', data: { percent: 40 } } as unknown as JobEvent);
      subject.next({ type: 'completed', data: { runId: 'run-1' } } as unknown as JobEvent);
      const out = await collected;
      expect(out.map((e) => e.type)).toEqual(['progress', 'completed']); // inclusive terminal
    });

    it('degrades to an empty stream when getRunRef throws (SSE must not reject)', async () => {
      const { controller } = make({ runRefError: new Error('boom') });
      const events = await controller.stream('an-1', ACTOR);
      expect(await firstValueFrom(events.pipe(toArray()))).toEqual([]);
    });
  });
});
