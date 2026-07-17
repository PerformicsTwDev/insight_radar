import type { Job, Worker } from 'bullmq';
import type { PrismaService } from '../prisma';
import type { CustomClassifyJobPayload } from '../queue/custom-classify-job.types';
import type { CustomClassifyAssignRepository } from './custom-classify-assign.repository';
import type { CustomClassifyRunRepository } from './custom-classify-run.repository';
import type { AssignedKeyword } from './custom-classify-assign-postprocess';
import type { CustomClassifyAssignService } from './custom-classify-assign.service';
import { CustomClassifyAssignProcessor } from './custom-classify-assign.processor';

interface BuildOpts {
  rows?: { text: string }[];
  assigned?: AssignedKeyword[];
  loadError?: Error;
}
function build(opts: BuildOpts = {}) {
  const findMany = jest.fn(() =>
    opts.loadError
      ? Promise.reject(opts.loadError)
      : Promise.resolve((opts.rows ?? [{ text: 'a' }, { text: 'b' }]).map((r) => ({ data: r }))),
  );
  const prisma = {
    snapshotRow: { findMany },
  } as unknown as PrismaService;

  const classifyByLabels = jest.fn(() =>
    Promise.resolve(
      opts.assigned ?? [
        { keyword: 'a', label: 'transactional' },
        { keyword: 'b', label: 'unclassified' },
      ],
    ),
  );
  const assign = { classifyByLabels } as unknown as CustomClassifyAssignService;

  const saveAssignments = jest.fn(() => Promise.resolve(undefined));
  const assignments = { saveAssignments } as unknown as CustomClassifyAssignRepository;

  const markStatus = jest.fn((_runId: string, _status: string, _outcome?: unknown) =>
    Promise.resolve(undefined),
  );
  const updateProgress = jest.fn((_runId: string, _progress: unknown) =>
    Promise.resolve(undefined),
  );
  const runRepo = { markStatus, updateProgress } as unknown as CustomClassifyRunRepository;

  const processor = new CustomClassifyAssignProcessor(prisma, assign, assignments, runRepo, {
    queueConcurrency: 3,
  });
  return {
    processor,
    findMany,
    classifyByLabels,
    saveAssignments,
    markStatus,
    updateProgress,
  };
}

const JOB_LABELS = [{ label: 'transactional', description: 'buy' }];

function makeJob(over: Partial<CustomClassifyJobPayload> = {}): {
  j: Job<CustomClassifyJobPayload>;
  jobUpdate: jest.Mock;
} {
  const jobUpdate = jest.fn((_progress: unknown) => Promise.resolve(undefined));
  const j = {
    data: {
      runId: 'run-1',
      analysisId: 'an-1',
      classificationId: 'cid-1',
      snapshotId: 'snap-1',
      labels: JOB_LABELS,
      params: { schemaVersion: 'v1', deployment: 'd', labelsHash: 'lh' },
      ...over,
    },
    updateProgress: jobUpdate,
  } as unknown as Job<CustomClassifyJobPayload>;
  return { j, jobUpdate };
}

describe('CustomClassifyAssignProcessor (T12.8 / FR-34 / AC-34.2)', () => {
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

  describe('process', () => {
    it('loads labels + keywords, classifies, persists assignments, marks completed', async () => {
      const { processor, findMany, classifyByLabels, saveAssignments, markStatus, updateProgress } =
        build();
      const { j, jobUpdate } = makeJob();
      const result = await processor.process(j);

      expect(result).toEqual({ status: 'completed', keywordCount: 2 });
      expect(findMany).toHaveBeenCalledWith({
        where: { snapshotId: 'snap-1' },
        orderBy: { rowIndex: 'asc' },
      });
      // classify with (cid, confirmed labels, original keyword text ordered by rowIndex)
      expect(classifyByLabels).toHaveBeenCalledWith(
        'cid-1',
        [{ label: 'transactional', description: 'buy' }],
        ['a', 'b'],
      );
      // persist with normalizedText keys + labels (incl. the unclassified sentinel)
      expect(saveAssignments).toHaveBeenCalledWith('cid-1', [
        { normalizedText: 'a', label: 'transactional' },
        { normalizedText: 'b', label: 'unclassified' },
      ]);
      expect(markStatus).toHaveBeenNthCalledWith(1, 'run-1', 'running');
      expect(markStatus).toHaveBeenNthCalledWith(2, 'run-1', 'completed', { keywordCount: 2 });
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

    it('a best-effort job.updateProgress failure does not abort the run', async () => {
      const { processor, markStatus } = build();
      const { j, jobUpdate } = makeJob();
      jobUpdate.mockRejectedValue(new Error('sse down'));
      const result = await processor.process(j);
      expect(result).toEqual({ status: 'completed', keywordCount: 2 });
      expect(markStatus).toHaveBeenNthCalledWith(2, 'run-1', 'completed', { keywordCount: 2 });
    });

    it('a non-Error throw is stringified for the failure message/log', async () => {
      const { processor, markStatus } = build();
      const nonError = 'weird' as unknown as Error;
      (
        processor as unknown as { assign: { classifyByLabels: jest.Mock } }
      ).assign.classifyByLabels = jest.fn(() => Promise.reject(nonError));
      await expect(processor.process(makeJob().j)).rejects.toBe('weird');
      expect(markStatus).toHaveBeenCalledWith('run-1', 'failed', { error: 'weird' });
    });

    it('a failure while marking failed is swallowed (does not mask the original error)', async () => {
      const { processor, markStatus } = build({ loadError: new Error('db down') });
      markStatus.mockImplementation((_id: string, status: string) =>
        status === 'failed' ? Promise.reject(new Error('mark down')) : Promise.resolve(undefined),
      );
      await expect(processor.process(makeJob().j)).rejects.toThrow('db down');
    });
  });
});
