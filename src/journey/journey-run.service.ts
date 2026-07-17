import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { assertOwnedRow, canAccess } from '../common/owner-scope';
import { scrubSecrets } from '../logger/redaction';
import { PrismaService } from '../prisma';
import { JOURNEY_QUEUE } from '../queue/queue.constants';
import type { JourneyJobPayload } from '../queue/journey-job.types';
import { computeJourneyIdempotencyKey } from './journey-idempotency';
import { JourneyRunRepository } from './journey-run.repository';
import type { JourneyRunParams } from './journey-run.types';

/** HTTP 425 Too Early（不在此版 NestJS `HttpStatus` enum 內；snapshot 進行中→稍後重試）。 */
const HTTP_TOO_EARLY = 425;

/** DI token for JourneyRunService 設定（由 module 從 cache/azure/queue config 組裝）。 */
export const JOURNEY_RUN_CONFIG = Symbol('JOURNEY_RUN_CONFIG');

export interface JourneyRunConfig {
  schemaVersion: string;
  deployment: string;
  /** 單次分類的關鍵字數上限（成本護欄，#484）。 */
  maxKeywords: number;
  jobAttempts: number;
  jobBackoffMs: number;
  jobBackoffJitter: number;
}

/** GET /:id/journey 回應（run 狀態，供輪詢；stage 表另經 POST /query{view:'journey'}）。 */
export interface JourneyStatusResponse {
  journeyJobId: string;
  status: string;
  progress: unknown;
  keywordCount: number | null;
}

/**
 * JourneyRunService（T12.6，FR-33/AC-33.6）。`create` = **enqueue-only**（NFR-1，不呼叫任何外部 API）：
 * owner 單點閘（`assertOwnedRow`，未知/他人→404，param 不可繞，#484 IDOR）→ snapshot readiness（進行中→425、
 * 失敗/取消→409）→ **input 上限**（keyword 數 > `maxKeywords`→413，#484 成本護欄）→ idempotency（snapshot.checksum
 * + canonical params）→ `createRun`（命中回同一 journeyJobId、不重跑）→ 僅 created 才 `queue.add`。入列失敗補償刪孤兒 run。
 * 分類/寫入皆在 worker（processor）。
 */
@Injectable()
export class JourneyRunService {
  private readonly logger = new Logger(JourneyRunService.name);

  constructor(
    @InjectQueue(JOURNEY_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly repo: JourneyRunRepository,
    @Inject(JOURNEY_RUN_CONFIG) private readonly config: JourneyRunConfig,
  ) {}

  async create(analysisId: string, actor: AuthenticatedUser): Promise<{ journeyJobId: string }> {
    const analysis = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      include: { resultSnapshot: true },
    });
    // owner 過濾單點（FR-27/AC-27.3，#484 IDOR）：未知 id 或他人分析 → 同一 404；owner 由 actor 決定、非 param。
    assertOwnedRow(analysis, actor, `keyword analysis ${analysisId} not found`);
    if (
      !analysis.resultSnapshot ||
      (analysis.status !== 'completed' && analysis.status !== 'partial')
    ) {
      if (analysis.status === 'queued' || analysis.status === 'running') {
        throw new HttpException(`analysis ${analysisId} snapshot not ready`, HTTP_TOO_EARLY);
      }
      throw new ConflictException(
        `analysis ${analysisId} has no usable snapshot (status ${analysis.status})`,
      );
    }

    // input 上限（#484 成本護欄）：整批 LLM 貼標成本隨 keyword 數線性上升 → 超過上限拒絕（413）。
    const keywordCount = await this.prisma.snapshotRow.count({
      where: { snapshotId: analysis.resultSnapshot.id },
    });
    if (keywordCount > this.config.maxKeywords) {
      throw new PayloadTooLargeException(
        `snapshot has ${keywordCount} keywords, exceeds journey max ${this.config.maxKeywords}`,
      );
    }

    const params: JourneyRunParams = {
      schemaVersion: this.config.schemaVersion,
      deployment: this.config.deployment,
    };
    const idempotencyKey = computeJourneyIdempotencyKey(
      analysisId,
      analysis.resultSnapshot.checksum,
      params,
    );

    const { runId, created } = await this.repo.createRun({
      keywordAnalysisId: analysisId,
      snapshotId: analysis.resultSnapshot.id,
      idempotencyKey,
      params: params as unknown as Prisma.InputJsonValue,
    });

    // idempotency 命中（created=false）→ 既有 run，不重複 enqueue。
    if (created) {
      const payload: JourneyJobPayload = {
        runId,
        analysisId,
        snapshotId: analysis.resultSnapshot.id,
        params,
      };
      try {
        await this.queue.add(JOURNEY_QUEUE, payload, {
          jobId: runId,
          attempts: this.config.jobAttempts,
          backoff: {
            type: 'exponential',
            delay: this.config.jobBackoffMs,
            jitter: this.config.jobBackoffJitter,
          },
        });
      } catch (error) {
        // 入列失敗（Redis 短暫不可用）→ 補償刪孤兒 run（否則 idempotencyKey 卡住、永不重跑）。
        this.logger.error(`enqueue journey job failed: ${scrubSecrets(String(error))}`);
        await this.prisma.journeyRun.delete({ where: { id: runId } });
        throw error;
      }
    }

    return { journeyJobId: runId };
  }

  /** 取某分析最新 run 狀態（GET；無 run→404；進行中→回其 status，client 續輪詢）。 */
  async getStatus(analysisId: string, actor: AuthenticatedUser): Promise<JourneyStatusResponse> {
    const owner = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: { ownerId: true },
    });
    assertOwnedRow(owner, actor, `keyword analysis ${analysisId} not found`);

    const run = await this.repo.findLatestRunByAnalysis(analysisId);
    if (!run) {
      throw new NotFoundException(`no journey run for analysis ${analysisId}`);
    }
    return {
      journeyJobId: run.id,
      status: run.status,
      progress: run.progress,
      keywordCount: run.keywordCount,
    };
  }

  /**
   * SSE 用輕量 run 參照：analysisId → 最新 run 的 {runId, status}（SSE key=runId，因 queue.add jobId=runId）。
   * owner 過濾用 `canAccess`（非 assertOwnedRow）避免 SSE 路徑拋例外——他人/未知 → null → 空串流（不洩漏存在性）。
   */
  async getRunRef(
    analysisId: string,
    actor: AuthenticatedUser,
  ): Promise<{ runId: string; status: string } | null> {
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
