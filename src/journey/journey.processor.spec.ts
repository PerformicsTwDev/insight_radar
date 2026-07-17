import type { Job, Worker } from 'bullmq';
import type { PrismaService } from '../prisma';
import type { JourneyJobPayload } from '../queue/journey-job.types';
import type { JourneyRepository } from './journey.repository';
import type { JourneyRunRepository } from './journey-run.repository';
import type { StagedKeyword } from './journey-postprocess';
import type { JourneyService } from './journey.service';
import { JourneyProcessor } from './journey.processor';

interface BuildOpts {
  rows?: { text: string }[];
  staged?: StagedKeyword[];
  loadError?: Error;
}
function build(opts: BuildOpts = {}) {
  const findMany = jest.fn(() =>
    opts.loadError
      ? Promise.reject(opts.loadError)
      : Promise.resolve((opts.rows ?? [{ text: 'a' }, { text: 'b' }]).map((r) => ({ data: r }))),
  );
  const prisma = { snapshotRow: { findMany } } as unknown as PrismaService;

  const classify = jest.fn(() =>
    Promise.resolve(
      opts.staged ?? [
        { keyword: 'a', stage: 'need_definition' as const },
        { keyword: 'b', stage: 'final_decision' as const },
      ],
    ),
  );
  const journey = { classify } as unknown as JourneyService;

  const saveAssignments = jest.fn(() => Promise.resolve(undefined));
  const assignments = { saveAssignments } as unknown as JourneyRepository;

  const markStatus = jest.fn((_runId: string, _status: string, _outcome?: unknown) =>
    Promise.resolve(undefined),
  );
  const updateProgress = jest.fn((_runId: string, _progress: unknown) =>
    Promise.resolve(undefined),
  );
  const runRepo = { markStatus, updateProgress } as unknown as JourneyRunRepository;

  const processor = new JourneyProcessor(prisma, journey, assignments, runRepo, {
    queueConcurrency: 3,
  });
  return { processor, findMany, classify, saveAssignments, markStatus, updateProgress };
}

function makeJob(over: Partial<JourneyJobPayload> = {}): {
  j: Job<JourneyJobPayload>;
  jobUpdate: jest.Mock;
} {
  const jobUpdate = jest.fn((_progress: unknown) => Promise.resolve(undefined));
  const j = {
    data: {
      runId: 'run-1',
      analysisId: 'an-1',
      snapshotId: 'snap-1',
      params: { schemaVersion: 'v1', deployment: 'd' },
      ...over,
    },
    updateProgress: jobUpdate,
  } as unknown as Job<JourneyJobPayload>;
  return { j, jobUpdate };
}

describe('JourneyProcessor (T12.6 / FR-33 / AC-33.6)', () => {
  describe('lifecycle', () => {
    it('onApplicationBootstrap sets worker concurrency from config and runs it', async () => {
      const { processor } = build();
      const run = jest.fn(() => Promise.resolve(undefined));
      const worker = { concurrency: 0, run } as unknown as Worker;
      (processor as unknown as { _worker: Worker })._worker = worker;

      await processor.onApplicationBootstrap();
      expect(worker.concurrency).toBe(3);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('onModuleDestroy drains the worker (and is a no-op when absent)', async () => {
      const { processor } = build();
      await expect(processor.onModuleDestroy()).resolves.toBeUndefined(); // no worker → no-op

      const close = jest.fn(() => Promise.resolve(undefined));
      (processor as unknown as { _worker: Worker })._worker = { close } as unknown as Worker;
      await processor.onModuleDestroy();
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe('process', () => {
    it('classifies the snapshot keywords, persists assignments, marks completed', async () => {
      const { processor, findMany, classify, saveAssignments, markStatus, updateProgress } =
        build();
      const { j, jobUpdate } = makeJob();
      const result = await processor.process(j);

      expect(result).toEqual({ status: 'completed', keywordCount: 2 });
      expect(findMany).toHaveBeenCalledWith({
        where: { snapshotId: 'snap-1' },
        orderBy: { rowIndex: 'asc' },
      });
      expect(classify).toHaveBeenCalledWith(['a', 'b']); // original text, ordered by rowIndex
      expect(saveAssignments).toHaveBeenCalledWith({
        analysisId: 'an-1',
        snapshotId: 'snap-1',
        staged: [
          { keyword: 'a', stage: 'need_definition' },
          { keyword: 'b', stage: 'final_decision' },
        ],
      });
      expect(markStatus).toHaveBeenNthCalledWith(1, 'run-1', 'running');
      expect(markStatus).toHaveBeenNthCalledWith(2, 'run-1', 'completed', { keywordCount: 2 });
      // progress written to DB + published to the SSE job
      expect(updateProgress.mock.calls.map((c) => (c[1] as { phase: string }).phase)).toEqual([
        'loading',
        'classifying',
        'persisting',
        'done',
      ]);
      expect(jobUpdate).toHaveBeenCalledTimes(4);
    });

    it('an infra error → marks failed and rethrows (BullMQ retries)', async () => {
      const { processor, markStatus, saveAssignments } = build({ loadError: new Error('db down') });
      await expect(processor.process(makeJob().j)).rejects.toThrow('db down');
      expect(markStatus).toHaveBeenNthCalledWith(1, 'run-1', 'running');
      expect(markStatus).toHaveBeenCalledWith('run-1', 'failed', { error: 'db down' });
      expect(saveAssignments).not.toHaveBeenCalled();
    });

    it('a best-effort job.updateProgress failure does not abort the run (SSE publish is best-effort)', async () => {
      const { processor, markStatus } = build();
      const { j, jobUpdate } = makeJob();
      jobUpdate.mockRejectedValue(new Error('sse down')); // publish fails on every phase
      const result = await processor.process(j);
      expect(result).toEqual({ status: 'completed', keywordCount: 2 }); // DB progress still written → completes
      expect(markStatus).toHaveBeenNthCalledWith(2, 'run-1', 'completed', { keywordCount: 2 });
    });

    it('a non-Error throw is stringified for the failure message/log', async () => {
      const { processor, markStatus } = build();
      // classify rejects with a **non-Error** value → exercises the `String(error)` defensive branch.
      // Cast to Error so prefer-promise-reject-errors is satisfied while the runtime value stays a string.
      const nonError = 'weird' as unknown as Error;
      (processor as unknown as { journey: { classify: jest.Mock } }).journey.classify = jest.fn(
        () => Promise.reject(nonError),
      );
      await expect(processor.process(makeJob().j)).rejects.toBe('weird');
      expect(markStatus).toHaveBeenCalledWith('run-1', 'failed', { error: 'weird' });
    });

    it('a failure while marking failed is swallowed (does not mask the original error)', async () => {
      const { processor, markStatus } = build({ loadError: new Error('db down') });
      markStatus.mockImplementation((_id: string, status: string) =>
        status === 'failed' ? Promise.reject(new Error('mark down')) : Promise.resolve(undefined),
      );
      await expect(processor.process(makeJob().j)).rejects.toThrow('db down'); // original, not 'mark down'
    });
  });

  describe('lifecycle resilience', () => {
    it('onApplicationBootstrap swallows a worker.run() rejection (logged, not thrown)', async () => {
      const { processor } = build();
      const run = jest.fn(() => Promise.reject(new Error('boot redis down')));
      (processor as unknown as { _worker: Worker })._worker = {
        concurrency: 0,
        run,
      } as unknown as Worker;
      await expect(processor.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(run).toHaveBeenCalledTimes(1);
    });
  });
});
