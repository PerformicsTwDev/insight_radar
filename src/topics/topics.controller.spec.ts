import { lastValueFrom, of } from 'rxjs';
import { toArray } from 'rxjs/operators';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { type JobEvent, type JobEventsService } from '../queue/job-events.service';
import type { TopicsResponse } from './build-topics-response';
import type { CreateTopicRunDto } from './dto/create-topic-run.dto';
import { TopicsController } from './topics.controller';
import type { TopicsService } from './topics.service';

// existing tests exercise topics wiring (not owner scope) → apiKey actor（gate 為 no-op、見全部，行為同 M9 前）。
const ACTOR: AuthenticatedUser = { kind: 'apiKey' };

function makeController(
  serviceOverrides: Partial<TopicsService>,
  forJob = jest.fn(),
): TopicsController {
  const events = { forJob } as unknown as JobEventsService;
  return new TopicsController(serviceOverrides as unknown as TopicsService, events, {
    sseHeartbeatMs: 15000,
  } as unknown as ConstructorParameters<typeof TopicsController>[2]);
}

describe('TopicsController (T8.10)', () => {
  it('delegates create to the service (with the current actor) and returns the topicJobId', async () => {
    const create = jest.fn<
      Promise<{ topicJobId: string }>,
      [string, CreateTopicRunDto, AuthenticatedUser]
    >();
    create.mockResolvedValue({ topicJobId: 'run-1' });
    const controller = makeController({ create });

    const dto: CreateTopicRunDto = { serpEnabled: true };
    const result = await controller.create('analysis-1', dto, ACTOR);

    expect(create).toHaveBeenCalledWith('analysis-1', dto, ACTOR);
    expect(result).toEqual({ topicJobId: 'run-1' });
  });

  it('delegates getTopics to the service (with the current actor)', async () => {
    const response = { status: 'completed' } as TopicsResponse;
    const getTopics = jest
      .fn<Promise<TopicsResponse>, [string, AuthenticatedUser]>()
      .mockResolvedValue(response);
    const controller = makeController({ getTopics });

    expect(await controller.getTopics('analysis-1', ACTOR)).toBe(response);
    expect(getTopics).toHaveBeenCalledWith('analysis-1', ACTOR);
  });

  describe('SSE stream', () => {
    it('returns an empty stream when there is no run (unknown analysis)', async () => {
      const getRunRef = jest.fn().mockResolvedValue(null);
      const controller = makeController({ getRunRef });

      const events = await lastValueFrom((await controller.stream('x', ACTOR)).pipe(toArray()));
      expect(events).toEqual([]); // EMPTY → 立即完成、不 hang
    });

    it('emits a single terminal snapshot for a completed run (no forJob subscription)', async () => {
      const getRunRef = jest.fn().mockResolvedValue({ runId: 'run-1', status: 'completed' });
      const forJob = jest.fn();
      const controller = makeController({ getRunRef }, forJob);

      const emitted = await lastValueFrom((await controller.stream('a', ACTOR)).pipe(toArray()));
      expect(emitted).toEqual([
        { type: 'completed', data: { runId: 'run-1', status: 'completed' } },
      ]);
      expect(forJob).not.toHaveBeenCalled();
    });

    it('emits a failed terminal snapshot for a failed/canceled run', async () => {
      const getRunRef = jest.fn().mockResolvedValue({ runId: 'run-1', status: 'failed' });
      const forJob = jest.fn();
      const controller = makeController({ getRunRef }, forJob);

      const emitted = await lastValueFrom((await controller.stream('a', ACTOR)).pipe(toArray()));
      expect(emitted).toEqual([{ type: 'failed', data: { error: 'failed' } }]);
      expect(forJob).not.toHaveBeenCalled();
    });

    it('subscribes to forJob(runId) for an in-progress run and maps events (inclusive terminal)', async () => {
      const getRunRef = jest.fn().mockResolvedValue({ runId: 'run-1', status: 'running' });
      const source: JobEvent[] = [
        { type: 'progress', data: { phase: 'embed', percent: 55 } },
        { type: 'completed', data: { runId: 'run-1' } },
        { type: 'progress', data: { phase: 'after', percent: 100 } }, // 終態後不應再發
      ];
      const forJob = jest.fn().mockReturnValue(of(...source));
      const controller = makeController({ getRunRef }, forJob);

      const emitted = await lastValueFrom((await controller.stream('a', ACTOR)).pipe(toArray()));
      expect(forJob).toHaveBeenCalledWith('run-1');
      expect(emitted).toEqual([
        { type: 'progress', data: { phase: 'embed', percent: 55 } },
        { type: 'completed', data: { runId: 'run-1' } },
      ]);
    });

    it('maps a failed event into an {error} payload', async () => {
      const getRunRef = jest.fn().mockResolvedValue({ runId: 'run-1', status: 'running' });
      const failedEvent: JobEvent = { type: 'failed', data: 'boom' };
      const forJob = jest.fn().mockReturnValue(of(failedEvent));
      const controller = makeController({ getRunRef }, forJob);

      const emitted = await lastValueFrom((await controller.stream('a', ACTOR)).pipe(toArray()));
      expect(emitted).toEqual([{ type: 'failed', data: { error: 'boom' } }]);
    });

    it('degrades to an empty stream (does not reject) when getRunRef throws', async () => {
      const getRunRef = jest.fn().mockRejectedValue(new Error('db down'));
      const controller = makeController({ getRunRef });

      const emitted = await lastValueFrom((await controller.stream('a', ACTOR)).pipe(toArray()));
      expect(emitted).toEqual([]); // 不 reject（SSE reject 會 hang）
    });
  });
});
