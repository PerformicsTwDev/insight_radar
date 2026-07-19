import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { assertOwnedRow, canAccess } from '../common/owner-scope';
import { embeddingsConfig } from '../config/embeddings.config';
import { queueConfig } from '../config/queue.config';
import { topicsConfig } from '../config/topics.config';
import { scrubSecrets } from '../logger/redaction';
import { PrismaService } from '../prisma';
import { TOPICS_QUEUE } from '../queue/queue.constants';
import { buildTopicsResponse, type TopicsResponse } from './build-topics-response';
import type { CreateTopicRunDto } from './dto/create-topic-run.dto';
import { computeTopicIdempotencyKey } from './topic-idempotency';
import type { TopicJobPayload } from './topic-job.types';
import type { TopicRunParams } from './topic-run.types';
import { TopicRepository } from './topic.repository';

/** HTTP 425 Too Early（不在此版 NestJS `HttpStatus` enum 內；snapshot 進行中→稍後重試）。 */
const HTTP_TOO_EARLY = 425;

/**
 * TopicsService（T8.10，FR-15）。`create` = **enqueue-only**（NFR-1，不呼叫任何外部 API）：
 * 檢查該分析的不可變 snapshot 是否 ready（未知→404、進行中→425、失敗/取消→409）→ 以 snapshot.checksum +
 * canonical params 算 idempotency key → `TopicRepository.createRun`（命中回同一 topicJobId、不重跑）→
 * `topics` queue.add（`enqueueReusingJobId` 安全重用 jobId；terminal-failed → reset queued 重入列）。分群/
 * embedding/命名/SERP 皆在 worker（T8.9）。入列失敗 → 標 run `failed`（**非** delete，#283 / M8-R3：保並發
 * idempotent 202 已回的 jobId 有效、可再 reset 重入列）。
 */
@Injectable()
export class TopicsService {
  private readonly logger = new Logger(TopicsService.name);

  constructor(
    @InjectQueue(TOPICS_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly repo: TopicRepository,
    @Inject(topicsConfig.KEY) private readonly topics: ConfigType<typeof topicsConfig>,
    @Inject(embeddingsConfig.KEY) private readonly embeddings: ConfigType<typeof embeddingsConfig>,
    @Inject(queueConfig.KEY) private readonly queueCfg: ConfigType<typeof queueConfig>,
  ) {}

  async create(
    analysisId: string,
    dto: CreateTopicRunDto,
    actor: AuthenticatedUser,
  ): Promise<{ topicJobId: string }> {
    const analysis = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      include: { resultSnapshot: true },
    });
    // owner 過濾單點（FR-27/AC-27.3）：未知 id 或他人分析 → 同一 404（不洩漏存在性）；避免跨 owner 對別人
    // 的 snapshot 建 TopicRun + 觸發昂貴分群 job。授權後 TS 收斂 analysis 為非 null。
    assertOwnedRow(analysis, actor, `keyword analysis ${analysisId} not found`);
    if (
      !analysis.resultSnapshot ||
      (analysis.status !== 'completed' && analysis.status !== 'partial')
    ) {
      // 進行中（queued/running）→ 425 Too Early（稍後重試）；失敗/取消 → 409（無可用 snapshot）。
      if (analysis.status === 'queued' || analysis.status === 'running') {
        throw new HttpException(`analysis ${analysisId} snapshot not ready`, HTTP_TOO_EARLY);
      }
      throw new ConflictException(
        `analysis ${analysisId} has no usable snapshot (status ${analysis.status})`,
      );
    }

    const params: TopicRunParams = {
      serpEnabled: dto.serpEnabled ?? false,
      embeddingModel: this.embeddings.model,
      embeddingSchemaVersion: this.embeddings.schemaVersion,
      promptVersion: this.topics.promptVersion,
      schemaVersion: this.topics.schemaVersion,
      ...(dto.umap ? { umap: dto.umap } : {}),
      ...(dto.hdbscan ? { hdbscan: dto.hdbscan } : {}),
      ...(dto.topK !== undefined ? { topK: dto.topK } : {}),
    };
    const { geo, language } = analysis.params as unknown as { geo: string; language: string };
    // M8-R7：key 綁 analysisId（+ checksum + params）→ 內容位元相同的不同分析不再撞同一 run（→ 永久 404）。
    const idempotencyKey = computeTopicIdempotencyKey(
      analysisId,
      analysis.resultSnapshot.checksum,
      params as unknown as Record<string, unknown>,
    );

    const { runId, created } = await this.repo.createRun({
      keywordAnalysisId: analysisId,
      snapshotId: analysis.resultSnapshot.id,
      idempotencyKey,
      params: params as unknown as Prisma.InputJsonValue,
    });

    // idempotency 命中（created=false）→ 既有 run（已入列/處理中/完成），不重複 enqueue。`created=true`
    // 亦含 terminal-`failed` 被 reset 重入列的 run（M8-R3）——沿用同一 jobId=runId。
    if (created) {
      const payload: TopicJobPayload = {
        runId,
        analysisId,
        snapshotId: analysis.resultSnapshot.id,
        geo,
        language,
        params,
      };
      try {
        await this.enqueueReusingJobId(runId, payload);
      } catch (error) {
        // 入列失敗（Redis 短暫不可用/ active 舊 job finalizing）→ 標 run `failed`（**非** delete，#283 / M8-R3，
        // 鏡像 M12-R7）：刪除會使並發 idempotent 202 已回同一 runId 給另一 client 者永久 404、job 永不執行；
        // 標 failed 則可由後續重送於 `createRun` reset 重入列（可恢復），並發輪詢見 `failed`（非 404）。
        this.logger.error(`enqueue topics job failed: ${scrubSecrets(String(error))}`);
        await this.repo.markStatus(runId, 'failed', {
          error: `enqueue failed: ${scrubSecrets(String(error))}`,
        });
        throw error;
      }
    }

    return { topicJobId: runId };
  }

  /**
   * 以 jobId=runId 入列，安全處理「reset 沿用同一 jobId」與 BullMQ dedup 語意（M8-R3；與 custom-classify M12-R1
   * 同構）：
   * - 無同 id 舊 job → 直接 add（全新 run 常態）。
   * - 有且**非 active**（failed/completed/delayed/waiting）→ `job.remove()` 後 add（可移除、重用 jobId）；否則
   *   同 jobId `add` 會靜默 dedup 成 no-op → run 卡 queued（不可恢復）。
   * - 有且 **active**（舊 attempt 仍持鎖，其 DB `failed` 早於 BullMQ finalize）→ 丟可重試 `503`：**不**盲 add
   *   （會 dedup no-op）。呼叫端 catch 標 `failed`（維持 reset-eligible），client 稍後重試——屆時舊 job 已 finalize。
   */
  private async enqueueReusingJobId(runId: string, payload: TopicJobPayload): Promise<void> {
    const stale = await this.queue.getJob(runId);
    if (stale) {
      const state = await stale.getState();
      if (state === 'active') {
        throw new ServiceUnavailableException(
          `topics run ${runId} is finalizing a prior attempt; retry shortly`,
        );
      }
      await stale.remove();
    }
    await this.queue.add(TOPICS_QUEUE, payload, {
      jobId: runId,
      attempts: this.queueCfg.jobAttempts,
      backoff: {
        type: 'exponential',
        delay: this.queueCfg.jobBackoffMs,
        jitter: this.queueCfg.jobBackoffJitter,
      },
    });
  }

  /**
   * 取某分析的分群結果（GET，Design §16.3）。無 run→404；進行中→回其 status（clusters 可能為空、client 續輪詢）。
   * 每字 topic/parent/intent 由所屬群繼承（不覆寫 FR-4 keyword_intents）。
   */
  async getTopics(analysisId: string, actor: AuthenticatedUser): Promise<TopicsResponse> {
    // owner 過濾單點（FR-27/AC-27.3）：先閘父分析——未知/他人 → 404，**否則**回別人的分群 + 關鍵字明文（IDOR）。
    const owner = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: { ownerId: true },
    });
    assertOwnedRow(owner, actor, `keyword analysis ${analysisId} not found`);

    const run = await this.repo.findLatestRunByAnalysis(analysisId);
    if (!run) {
      throw new NotFoundException(`no topic run for analysis ${analysisId}`);
    }
    const [clusters, assignments, keywordTexts] = await Promise.all([
      this.repo.loadClusters(run.id),
      this.repo.loadAssignments(run.id),
      this.repo.loadKeywordTexts(run.snapshotId),
    ]);
    return buildTopicsResponse(run, clusters, assignments, keywordTexts);
  }

  /**
   * SSE 用輕量 run 參照：analysisId → 最新 run 的 {runId, status}（SSE key=runId，因 queue.add jobId=runId）。
   * 無 run → null（SSE handler 據此回空串流）。
   */
  async getRunRef(
    analysisId: string,
    actor: AuthenticatedUser,
  ): Promise<{ runId: string; status: string } | null> {
    // owner 過濾單點（SSE 不可拋——他人/未知 → 回 null → EMPTY 串流，與 keyword-analysis stream 的降級一致、
    // 不洩漏存在性）。用 `canAccess`（非 assertOwnedRow）避免在 SSE 路徑拋例外。
    const owner = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: { ownerId: true },
    });
    if (!owner || !canAccess(owner, actor)) {
      return null;
    }
    const run = await this.repo.findLatestRunByAnalysis(analysisId);
    return run ? { runId: run.id, status: run.status } : null;
  }
}
