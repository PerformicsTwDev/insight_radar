import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
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
 * `topics` queue.add。分群/embedding/命名/SERP 皆在 worker（T8.9）。入列失敗補償刪除孤兒 run。
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

  async create(analysisId: string, dto: CreateTopicRunDto): Promise<{ topicJobId: string }> {
    const analysis = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      include: { resultSnapshot: true },
    });
    if (!analysis) {
      throw new NotFoundException(`keyword analysis ${analysisId} not found`);
    }
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
    const idempotencyKey = computeTopicIdempotencyKey(
      analysis.resultSnapshot.checksum,
      params as unknown as Record<string, unknown>,
    );

    const { runId, created } = await this.repo.createRun({
      keywordAnalysisId: analysisId,
      snapshotId: analysis.resultSnapshot.id,
      idempotencyKey,
      params: params as unknown as Prisma.InputJsonValue,
    });

    // idempotency 命中（created=false）→ 既有 run（已入列/處理中/完成），不重複 enqueue。
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
        await this.queue.add(TOPICS_QUEUE, payload, {
          jobId: runId,
          attempts: this.queueCfg.jobAttempts,
          backoff: {
            type: 'exponential',
            delay: this.queueCfg.jobBackoffMs,
            jitter: this.queueCfg.jobBackoffJitter,
          },
        });
      } catch (error) {
        // 入列失敗（Redis 短暫不可用）→ 補償刪除孤兒 run（否則 idempotencyKey 卡住、永不重跑）。
        this.logger.error(`enqueue topics job failed: ${scrubSecrets(String(error))}`);
        await this.prisma.topicRun.delete({ where: { id: runId } });
        throw error;
      }
    }

    return { topicJobId: runId };
  }

  /**
   * 取某分析的分群結果（GET，Design §16.3）。無 run→404；進行中→回其 status（clusters 可能為空、client 續輪詢）。
   * 每字 topic/parent/intent 由所屬群繼承（不覆寫 FR-4 keyword_intents）。
   */
  async getTopics(analysisId: string): Promise<TopicsResponse> {
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
  async getRunRef(analysisId: string): Promise<{ runId: string; status: string } | null> {
    const run = await this.repo.findLatestRunByAnalysis(analysisId);
    return run ? { runId: run.id, status: run.status } : null;
  }
}
