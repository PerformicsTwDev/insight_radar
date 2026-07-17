import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
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
 * + canonical params）→ `createRun`（命中回同一 journeyJobId；terminal-failed/canceled → reset queued 重入列）→ 僅
 * created 才入列（`enqueueReusingJobId`：探舊 job 狀態安全重用 jobId）。入列失敗 → 標 run `failed`（**非** delete，
 * M12-R7：保並發 idempotent 202 的 jobId 有效、可再 reset 重入列）。分類/寫入皆在 worker（processor）。
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
        // reset 的 run 沿用同一 jobId → 須先清 BullMQ 內的舊 job 才能以同 jobId 重加。但 `queue.remove` 對
        // **鎖定中（active）** job 回 0（不 reject），且同 jobId `add` 會靜默 dedup 成 no-op（handleDuplicatedJob）；
        // 盲 remove().catch()→add() 遇 active 舊 job 會回 202 卻未入列、run 卡 queued（不可恢復）。故先探 job 狀態：
        await this.enqueueReusingJobId(runId, payload);
      } catch (error) {
        // 入列失敗（Redis 短暫不可用）→ 標 failed（**非** delete）：刪除會使並發 idempotent 202 已回的 jobId 變 404
        // （M12-R7）；標 failed 則可由後續重送 reset 重入列（M12-R1），並發輪詢見 failed 非 404。
        this.logger.error(`enqueue journey job failed: ${scrubSecrets(String(error))}`);
        await this.repo.markStatus(runId, 'failed', {
          error: `enqueue failed: ${scrubSecrets(String(error))}`,
        });
        throw error;
      }
    }

    return { journeyJobId: runId };
  }

  /**
   * 以 jobId=runId 入列，安全處理「reset 沿用同一 jobId」與 BullMQ dedup 語意（M12-R1 補強）：
   * - 無同 id 舊 job → 直接 add（新 run 的常態）。
   * - 有且**非 active**（failed/completed/delayed/waiting）→ `job.remove()` 後 add（可移除、重用 jobId）。
   * - 有且 **active**（舊 attempt 仍持鎖處理中，其 DB `failed` 早於 BullMQ finalize）→ 丟可重試 `503`：**不**盲 add
   *   （會 no-op dedup）。呼叫端 catch 標 `failed`（維持 reset-eligible），client 稍後重試——屆時舊 job 已 finalize
   *   至 failed set（非鎖定）→ 可移除重加。
   */
  private async enqueueReusingJobId(runId: string, payload: JourneyJobPayload): Promise<void> {
    const stale = await this.queue.getJob(runId);
    if (stale) {
      const state = await stale.getState();
      if (state === 'active') {
        throw new ServiceUnavailableException(
          `journey run ${runId} is finalizing a prior attempt; retry shortly`,
        );
      }
      await stale.remove();
    }
    await this.queue.add(JOURNEY_QUEUE, payload, {
      jobId: runId,
      attempts: this.config.jobAttempts,
      backoff: {
        type: 'exponential',
        delay: this.config.jobBackoffMs,
        jitter: this.config.jobBackoffJitter,
      },
    });
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
