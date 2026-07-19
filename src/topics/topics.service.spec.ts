import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from '../common/authenticated-user';
import type { embeddingsConfig } from '../config/embeddings.config';
import type { queueConfig } from '../config/queue.config';
import type { topicsConfig } from '../config/topics.config';
import type { PrismaService } from '../prisma';
import type { CreateTopicRunResult, TopicRepository } from './topic.repository';
import { TopicsService } from './topics.service';

interface Deps {
  add: jest.Mock;
  getJob: jest.Mock;
  findUnique: jest.Mock;
  deleteRun: jest.Mock;
  createRun: jest.Mock<Promise<CreateTopicRunResult>, [unknown]>;
  markStatus: jest.Mock;
  findLatestRunByAnalysis: jest.Mock;
  loadClusters: jest.Mock;
  loadAssignments: jest.Mock;
  loadKeywordTexts: jest.Mock;
}

function makeService(): { service: TopicsService; deps: Deps } {
  const deps: Deps = {
    add: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(null), // 預設無同 id 舊 job（全新 run 常態）
    findUnique: jest.fn(),
    deleteRun: jest.fn().mockResolvedValue(undefined),
    createRun: jest.fn<Promise<CreateTopicRunResult>, [unknown]>(),
    markStatus: jest.fn().mockResolvedValue(undefined),
    findLatestRunByAnalysis: jest.fn(),
    loadClusters: jest.fn().mockResolvedValue([]),
    loadAssignments: jest.fn().mockResolvedValue([]),
    loadKeywordTexts: jest.fn().mockResolvedValue(new Map()),
  };
  const queue = { add: deps.add, getJob: deps.getJob } as unknown as Queue;
  const prisma = {
    keywordAnalysis: { findUnique: deps.findUnique },
    topicRun: { delete: deps.deleteRun },
  } as unknown as PrismaService;
  const repo = {
    createRun: deps.createRun,
    markStatus: deps.markStatus,
    findLatestRunByAnalysis: deps.findLatestRunByAnalysis,
    loadClusters: deps.loadClusters,
    loadAssignments: deps.loadAssignments,
    loadKeywordTexts: deps.loadKeywordTexts,
  } as unknown as TopicRepository;
  const topics = { promptVersion: 'v1', schemaVersion: 'v1' } as ConfigType<typeof topicsConfig>;
  const embeddings = {
    model: 'gemini-embedding-001',
    schemaVersion: 'v1',
  } as ConfigType<typeof embeddingsConfig>;
  const queueCfg = {
    jobAttempts: 5,
    jobBackoffMs: 3000,
    jobBackoffJitter: 0.2,
  } as ConfigType<typeof queueConfig>;
  const service = new TopicsService(queue, prisma, repo, topics, embeddings, queueCfg);
  return { service, deps };
}

// existing create/getTopics/getRunRef tests exercise topics wiring (not owner scope) → apiKey actor
// （owner gate 對 apiKey 為 no-op，見全部、行為同 M9 前）。owner-gate 專屬情境見底部 describe。
const ACTOR: AuthenticatedUser = { kind: 'apiKey' };

function analysis(
  status: string,
  hasSnapshot = status === 'completed' || status === 'partial',
  ownerId: string | null = null,
) {
  return {
    id: 'a-1',
    status,
    ownerId,
    params: { geo: 'US', language: 'en' },
    resultSnapshot: hasSnapshot ? { id: 'snap-1', checksum: 'chk', keywordCount: 3 } : null,
  };
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  const error = (await promise.catch((e: unknown) => e)) as HttpException;
  return error.getStatus();
}

describe('TopicsService.create (T8.10 / TC-48)', () => {
  it('404 when the analysis does not exist', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(null);

    await expect(service.create('missing', {}, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('425 Too Early when the analysis is still queued/running', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('running'));

    expect(await statusOf(service.create('a-1', {}, ACTOR))).toBe(425); // Too Early
    expect(deps.createRun).not.toHaveBeenCalled();
  });

  it('409 Conflict when the analysis failed/canceled (no usable snapshot)', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('failed'));

    await expect(service.create('a-1', {}, ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('enqueues and returns topicJobId for a completed analysis (202 path)', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('completed'));
    deps.createRun.mockResolvedValue({ runId: 'run-1', created: true });

    const result = await service.create('a-1', { serpEnabled: true, topK: 15 }, ACTOR);

    expect(result).toEqual({ topicJobId: 'run-1' });
    // createRun 帶 idempotencyKey + params（含版本 + serpEnabled + topK）。
    const createArg = deps.createRun.mock.calls[0][0] as {
      idempotencyKey: string;
      params: Record<string, unknown>;
    };
    expect(createArg.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(createArg.params).toMatchObject({ serpEnabled: true, topK: 15, promptVersion: 'v1' });
    // 入列：jobId=runId、payload 帶 geo/language。
    expect(deps.add).toHaveBeenCalledTimes(1);
    const [, payload, opts] = deps.add.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { jobId: string },
    ];
    expect(opts.jobId).toBe('run-1');
    expect(payload).toMatchObject({
      runId: 'run-1',
      analysisId: 'a-1',
      snapshotId: 'snap-1',
      geo: 'US',
      language: 'en',
    });
  });

  it('derives distinct idempotency keys for distinct analyses with identical checksum + params (M8-R7 wiring · M8-R13)', async () => {
    const { service, deps } = makeService();
    deps.createRun.mockResolvedValue({ runId: 'run-x', created: false });
    // 兩個 analysisId 不同、但 snapshot.checksum + params 位元完全相同的分析。
    const mkAnalysis = (id: string) => ({
      id,
      status: 'completed',
      params: { geo: 'US', language: 'en' },
      resultSnapshot: { id: `snap-${id}`, checksum: 'IDENTICAL', keywordCount: 3 },
    });

    deps.findUnique.mockResolvedValueOnce(mkAnalysis('analysis-A'));
    await service.create('analysis-A', { topK: 20 }, ACTOR);
    deps.findUnique.mockResolvedValueOnce(mkAnalysis('analysis-B'));
    await service.create('analysis-B', { topK: 20 }, ACTOR);

    const keyA = (deps.createRun.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;
    const keyB = (deps.createRun.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey;
    // 綁 analysisId → 內容位元相同的不同分析必得不同 key（否則後者複用前者的 run、GET 永久 404，M8-R7）。
    // 若把 analysisId 從 key 組成中拿掉（回退 M8-R7），兩 key 相同 → 本測試轉紅。
    expect(keyA).toMatch(/^[0-9a-f]{64}$/);
    expect(keyA).not.toBe(keyB);
  });

  it('does not re-enqueue on idempotency hit (created=false)', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('completed'));
    deps.createRun.mockResolvedValue({ runId: 'run-existing', created: false });

    const result = await service.create('a-1', {}, ACTOR);

    expect(result).toEqual({ topicJobId: 'run-existing' });
    expect(deps.add).not.toHaveBeenCalled(); // 命中既有 → 不重複入列
  });

  it('accepts a partial-snapshot analysis as ready', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('partial'));
    deps.createRun.mockResolvedValue({ runId: 'run-2', created: true });

    await expect(service.create('a-1', {}, ACTOR)).resolves.toEqual({ topicJobId: 'run-2' });
  });

  it('marks the run failed (never deletes) when enqueue fails — orphan-safe for concurrent idempotent runs (#283 / M8-R3)', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('completed'));
    deps.createRun.mockResolvedValue({ runId: 'run-3', created: true });
    deps.add.mockRejectedValue(new Error('redis down'));

    await expect(service.create('a-1', {}, ACTOR)).rejects.toThrow('redis down');
    // #283：**不得** delete——並發 idempotent 202 已回同一 runId 給另一 client，刪掉會使其永久 404、job 永不執行。
    expect(deps.deleteRun).not.toHaveBeenCalled();
    // 改標 failed（可恢復：後續重送於 createRun reset 重入列；並發輪詢見 failed 非 404；鏡像 M12-R7）。
    expect(deps.markStatus).toHaveBeenCalledTimes(1);
    const [runId, status, outcome] = deps.markStatus.mock.calls[0] as [
      string,
      string,
      { error: string },
    ];
    expect(runId).toBe('run-3');
    expect(status).toBe('failed');
    expect(outcome.error).toContain('enqueue failed');
  });

  it('re-enqueues a reset run by reusing jobId: removes a stale non-active job first (M8-R3 / M12-R1)', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('completed'));
    // createRun reset 了一個 terminal-failed run → created=true，沿用同一 runId（jobId）。
    deps.createRun.mockResolvedValue({ runId: 'run-r', created: true });
    const remove = jest.fn().mockResolvedValue(undefined);
    deps.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('failed'),
      remove,
    });

    await expect(service.create('a-1', {}, ACTOR)).resolves.toEqual({ topicJobId: 'run-r' });
    // 先移除非 active 的舊 job，才能以同 jobId 重加（否則 BullMQ dedup → no-op → run 卡 queued）。
    expect(remove).toHaveBeenCalledTimes(1);
    expect(deps.add).toHaveBeenCalledTimes(1);
  });

  it('503 (retryable) + marks failed when a stale job is still active (finalizing a prior attempt)', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue(analysis('completed'));
    deps.createRun.mockResolvedValue({ runId: 'run-a', created: true });
    deps.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('active'),
      remove: jest.fn(),
    });

    // active 舊 job 仍持鎖 → 不盲 add（會 dedup no-op）→ 丟 503 retryable；呼叫端標 failed 維持 reset-eligible。
    expect(await statusOf(service.create('a-1', {}, ACTOR))).toBe(503);
    expect(deps.add).not.toHaveBeenCalled();
    expect(deps.markStatus).toHaveBeenCalledWith('run-a', 'failed', expect.anything());
  });
});

describe('TopicsService.getTopics (T8.10b / TC-49)', () => {
  it('404 when the analysis has no topic run', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue({ ownerId: null }); // owner gate passes → reach "no run" branch
    deps.findLatestRunByAnalysis.mockResolvedValue(null);

    await expect(service.getTopics('a-1', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assembles the response from the latest run + clusters + assignments', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue({ ownerId: null }); // owner gate passes（apiKey/null-owner）
    deps.findLatestRunByAnalysis.mockResolvedValue({
      id: 'run-1',
      snapshotId: 'snap-1',
      status: 'completed',
      progress: { phase: 'persist', percent: 100 },
      clusterCount: 1,
      noiseCount: 0,
    });
    deps.loadClusters.mockResolvedValue([
      {
        clusterId: 'c0',
        clusterLabel: 0,
        topicName: 'Coffee',
        parentTopic: 'Beverages',
        intentLabel: 'commercial',
        topicType: 'head',
        reason: 'r',
        clusterVolume: 100n,
        keywordCount: 1,
        confidence: 0.9,
        representativeKeywords: [],
      },
    ]);
    deps.loadAssignments.mockResolvedValue([
      { normalizedText: 'a', clusterId: 'c0', confidence: 0.9, isNoise: false },
    ]);
    deps.loadKeywordTexts.mockResolvedValue(new Map([['a', 'Keyword A']]));

    const res = await service.getTopics('a-1', ACTOR);

    expect(res.status).toBe('completed');
    expect(res.meta.runId).toBe('run-1');
    expect(res.clusters[0].topicName).toBe('Coffee');
    expect(res.keywords[0]).toMatchObject({
      text: 'Keyword A',
      intentLabel: 'commercial',
      isNoise: false,
    });
    // 讀取以 run.id / run.snapshotId 為 key。
    expect(deps.loadKeywordTexts).toHaveBeenCalledWith('snap-1');
  });

  it('getRunRef returns {runId,status} for the latest run, or null', async () => {
    const { service, deps } = makeService();
    deps.findUnique.mockResolvedValue({ ownerId: null }); // owner gate passes for both lookups
    deps.findLatestRunByAnalysis.mockResolvedValueOnce({
      id: 'run-9',
      snapshotId: 'snap-9',
      status: 'running',
      progress: {},
      clusterCount: null,
      noiseCount: null,
    });
    expect(await service.getRunRef('a-1', ACTOR)).toEqual({ runId: 'run-9', status: 'running' });

    deps.findLatestRunByAnalysis.mockResolvedValueOnce(null);
    expect(await service.getRunRef('a-2', ACTOR)).toBeNull();
  });
});

/**
 * Owner scope gate on the topics sub-resource (FR-27 / AC-27.3~27.5 · TC-62; Design §17.5 S8). The parent
 * `KeywordAnalysis.ownerId` is enforced at the service layer via the shared `assertOwnedRow`/`canAccess`
 * single point: cross-owner **and** unknown id are indistinguishable (both 404 for create/getTopics; both
 * `null`→SSE EMPTY for getRunRef — the SSE path must never throw). apiKey (machine) actor is never
 * owner-filtered (M9-compatible). Covers the SSE `getRunRef→null` degradation here (unit) rather than in the
 * real-Postgres integration spec, where asserting an SSE stream is impractical.
 */
describe('TopicsService owner scope gate (FR-27 / AC-27.3~27.5 · TC-62)', () => {
  const SESSION_A: AuthenticatedUser = { kind: 'session', id: 'owner-A', email: 'a@example.com' };
  const SESSION_B: AuthenticatedUser = { kind: 'session', id: 'owner-B', email: 'b@example.com' };
  const API_KEY: AuthenticatedUser = { kind: 'apiKey' };

  /** Minimal completed run so getTopics/getRunRef can proceed past the gate. */
  const RUN = {
    id: 'run-1',
    snapshotId: 'snap-1',
    status: 'completed',
    progress: {},
    clusterCount: 0,
    noiseCount: 0,
  };

  describe('getTopics', () => {
    it('cross-owner session → NotFound (404, no existence leak) and never reads the run', async () => {
      const { service, deps } = makeService();
      deps.findUnique.mockResolvedValue({ ownerId: 'owner-A' }); // 屬 A

      await expect(service.getTopics('a-1', SESSION_B)).rejects.toBeInstanceOf(NotFoundException);
      expect(deps.findLatestRunByAnalysis).not.toHaveBeenCalled(); // gate short-circuits first
    });

    it('owner session → proceeds normally', async () => {
      const { service, deps } = makeService();
      deps.findUnique.mockResolvedValue({ ownerId: 'owner-A' });
      deps.findLatestRunByAnalysis.mockResolvedValue(RUN);

      const res = await service.getTopics('a-1', SESSION_A);
      expect(res.meta.runId).toBe('run-1');
    });

    it('apiKey (machine) actor → proceeds regardless of owner (unfiltered)', async () => {
      const { service, deps } = makeService();
      deps.findUnique.mockResolvedValue({ ownerId: 'owner-A' });
      deps.findLatestRunByAnalysis.mockResolvedValue(RUN);

      const res = await service.getTopics('a-1', API_KEY);
      expect(res.meta.runId).toBe('run-1');
    });

    it('unknown analysisId → NotFound (same 404 as cross-owner)', async () => {
      const { service, deps } = makeService();
      deps.findUnique.mockResolvedValue(null);

      await expect(service.getTopics('missing', SESSION_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(deps.findLatestRunByAnalysis).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('cross-owner session → NotFound before any snapshot check / createRun (no orphan run)', async () => {
      const { service, deps } = makeService();
      deps.findUnique.mockResolvedValue(analysis('completed', true, 'owner-A'));

      await expect(service.create('a-1', {}, SESSION_B)).rejects.toBeInstanceOf(NotFoundException);
      expect(deps.createRun).not.toHaveBeenCalled(); // 越權 → 不對別人 snapshot 建 run
    });

    it('owner session → proceeds normally (enqueues)', async () => {
      const { service, deps } = makeService();
      deps.findUnique.mockResolvedValue(analysis('completed', true, 'owner-A'));
      deps.createRun.mockResolvedValue({ runId: 'run-1', created: true });

      await expect(service.create('a-1', {}, SESSION_A)).resolves.toEqual({ topicJobId: 'run-1' });
    });

    it('apiKey (machine) actor → proceeds regardless of owner (unfiltered)', async () => {
      const { service, deps } = makeService();
      deps.findUnique.mockResolvedValue(analysis('completed', true, 'owner-A'));
      deps.createRun.mockResolvedValue({ runId: 'run-2', created: false });

      await expect(service.create('a-1', {}, API_KEY)).resolves.toEqual({ topicJobId: 'run-2' });
    });

    it('unknown analysisId → NotFound (same 404 as cross-owner)', async () => {
      const { service, deps } = makeService();
      deps.findUnique.mockResolvedValue(null);

      await expect(service.create('missing', {}, SESSION_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(deps.createRun).not.toHaveBeenCalled();
    });
  });

  describe('getRunRef (SSE — must never throw)', () => {
    it('cross-owner session → null → SSE degrades to EMPTY (no existence leak, no throw)', async () => {
      const { service, deps } = makeService();
      deps.findUnique.mockResolvedValue({ ownerId: 'owner-A' });

      await expect(service.getRunRef('a-1', SESSION_B)).resolves.toBeNull();
      expect(deps.findLatestRunByAnalysis).not.toHaveBeenCalled();
    });

    it('owner session → returns the run ref', async () => {
      const { service, deps } = makeService();
      deps.findUnique.mockResolvedValue({ ownerId: 'owner-A' });
      deps.findLatestRunByAnalysis.mockResolvedValue(RUN);

      await expect(service.getRunRef('a-1', SESSION_A)).resolves.toEqual({
        runId: 'run-1',
        status: 'completed',
      });
    });

    it('apiKey (machine) actor → returns the run ref regardless of owner', async () => {
      const { service, deps } = makeService();
      deps.findUnique.mockResolvedValue({ ownerId: 'owner-A' });
      deps.findLatestRunByAnalysis.mockResolvedValue(RUN);

      await expect(service.getRunRef('a-1', API_KEY)).resolves.toEqual({
        runId: 'run-1',
        status: 'completed',
      });
    });

    it('unknown analysisId → null (indistinguishable from cross-owner)', async () => {
      const { service, deps } = makeService();
      deps.findUnique.mockResolvedValue(null);

      await expect(service.getRunRef('missing', SESSION_A)).resolves.toBeNull();
      expect(deps.findLatestRunByAnalysis).not.toHaveBeenCalled();
    });
  });
});
