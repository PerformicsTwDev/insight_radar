import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { assertOwnedRow, canAccess, ownerIdOf } from '../common/owner-scope';
import { scrubSecrets } from '../logger/redaction';
import type { AiSearchJobPayload } from '../queue/ai-search-job.types';
import { AI_SEARCH_QUEUE } from '../queue/queue.constants';
import type { CreateAiSearchAnalysisDto } from './ai-search.dto';
import { computeAiSearchIdempotencyKey } from './ai-search-idempotency';
import { canonicalizeAiSearchKeywords } from './ai-search-keywords';
import { AiSearchRunRepository } from './ai-search-run.repository';
import type { AiSearchRunParams, AiSearchStatusResponse } from './ai-search-run.types';

/** DI token for AiSearchRunService 設定（由 module 從 queue config 組裝）。 */
export const AI_SEARCH_RUN_CONFIG = Symbol('AI_SEARCH_RUN_CONFIG');

export interface AiSearchRunConfig {
  /** 抓取層版本（`AI_SEARCH_SCHEMA_VERSION`）——入 idempotency key。 */
  schemaVersion: string;
  /**
   * 分析層版本（`AI_VISIBILITY_SCHEMA_VERSION`）——同入 idempotency key（M15-R5/#687）。T15.5 in-job 分析
   * 用它 tag `ai_answers`/`ai_cited_references`/`ai_visibility_metrics` 落列；漏此欄則 bump 分析版本 + 同輸入
   * POST 會命中既有 completed run（不 reset）→ 分析永不重跑、rows 停留舊版本。
   */
  analysisSchemaVersion: string;
  jobAttempts: number;
  jobBackoffMs: number;
  jobBackoffJitter: number;
}

/**
 * AiSearchRunService（T14.6，FR-41/AC-41.1）。`create` = **enqueue-only**（NFR-1，POST 路徑零外部呼叫）：owner 歸屬
 * → idempotency（owner + 語意輸入 canonical key）→ `createRun`（命中回同一 jobId；terminal-failed/canceled→reset 重入列）
 * → 僅 created 才入列（`enqueueReusingJobId`：探舊 job 狀態安全重用 jobId）。入列失敗 → 標 run `failed`（**非** delete，
 * 保並發 idempotent 202 的 jobId 有效、可再 reset 重入列）。SerpAPI pull / extension push 合流皆在 worker（processor）。
 */
@Injectable()
export class AiSearchRunService {
  private readonly logger = new Logger(AiSearchRunService.name);

  constructor(
    @InjectQueue(AI_SEARCH_QUEUE) private readonly queue: Queue,
    private readonly repo: AiSearchRunRepository,
    @Inject(AI_SEARCH_RUN_CONFIG) private readonly config: AiSearchRunConfig,
  ) {}

  async create(
    dto: CreateAiSearchAnalysisDto,
    actor: AuthenticatedUser,
  ): Promise<{ jobId: string }> {
    // owner 歸屬（FR-27/AC-27.1）：session→actor.id、apiKey→null（機器資源）。idempotency 依此分範圍（跨租戶不撞）。
    const ownerId = ownerIdOf(actor);
    const params: AiSearchRunParams = { schemaVersion: this.config.schemaVersion };
    const brandProfileId = dto.brandProfileId ?? null;
    // 正規化 + 去重 keywords 於**同一單點**（`canonicalizeAiSearchKeywords`，共用 `normalizeText`）：idempotency key
    // 與 job payload 必須用同一組字，否則 payload 夾帶 raw keywords → processor 對正規化後相同的字重複 SerpAPI
    // fetch（浪費 credits + 重複 canonical 列 + 灌大 captureCount，M14-R6/#582）。
    const canonicalKeywords = canonicalizeAiSearchKeywords(dto.keywords);
    const idempotencyKey = computeAiSearchIdempotencyKey(
      canonicalKeywords,
      dto.channels,
      brandProfileId,
      params,
      ownerId,
    );

    const { runId, created } = await this.repo.createRun({
      ownerId,
      idempotencyKey,
      params: params as unknown as Prisma.InputJsonValue,
    });

    // idempotency 命中（created=false）→ 既有 run，不重複 enqueue（AC-41.1）。
    if (created) {
      const payload: AiSearchJobPayload = {
        runId,
        ownerId,
        keywords: canonicalKeywords,
        channels: dto.channels,
        brandProfileId,
        params,
      };
      try {
        await this.enqueueReusingJobId(runId, payload);
      } catch (error) {
        // 入列失敗（Redis 短暫不可用）→ 標 failed（**非** delete）：刪除會使並發 idempotent 202 已回的 jobId 變 404；
        // 標 failed 則可由後續重送 reset 重入列，並發輪詢見 failed 非 404（比照 journey M12-R7）。
        this.logger.error(`enqueue ai-search job failed: ${scrubSecrets(String(error))}`);
        await this.repo.markStatus(runId, 'failed', {
          error: `enqueue failed: ${scrubSecrets(String(error))}`,
        });
        throw error;
      }
    }

    return { jobId: runId };
  }

  /**
   * 以 jobId=runId 入列，安全處理「reset 沿用同一 jobId」與 BullMQ dedup 語意（比照 journey）：
   * - 無同 id 舊 job → 直接 add（新 run 常態）。
   * - 有且**非 active** → `job.remove()` 後 add（可移除、重用 jobId）。
   * - 有且 **active**（舊 attempt 仍持鎖）→ 丟可重試 `503`：**不**盲 add（會 no-op dedup）；呼叫端標 failed（reset-eligible）。
   */
  private async enqueueReusingJobId(runId: string, payload: AiSearchJobPayload): Promise<void> {
    const stale = await this.queue.getJob(runId);
    if (stale) {
      const state = await stale.getState();
      if (state === 'active') {
        throw new ServiceUnavailableException(
          `ai search run ${runId} is finalizing a prior attempt; retry shortly`,
        );
      }
      await stale.remove();
    }
    await this.queue.add(AI_SEARCH_QUEUE, payload, {
      jobId: runId,
      attempts: this.config.jobAttempts,
      backoff: {
        type: 'exponential',
        delay: this.config.jobBackoffMs,
        jitter: this.config.jobBackoffJitter,
      },
    });
  }

  /** 取抓取 run 狀態（GET；owner 單點閘——未知/他人→同一 404，不洩漏存在性，AC-27.3/41.3）。 */
  async getStatus(id: string, actor: AuthenticatedUser): Promise<AiSearchStatusResponse> {
    const run = await this.repo.findById(id);
    assertOwnedRow(run, actor, `ai search run ${id} not found`);
    return {
      jobId: run.id,
      status: run.status,
      progress: run.progress,
      captureCount: run.captureCount,
    };
  }

  /**
   * SSE 用輕量 run 參照：id → {runId, status}。owner 過濾用 `canAccess`（非 assertOwnedRow）避免 SSE 路徑拋例外——
   * 他人/未知 → null → 空串流（不洩漏存在性）。
   */
  async getRunRef(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ runId: string; status: string } | null> {
    const run = await this.repo.findById(id);
    if (!run || !canAccess(run, actor)) {
      return null;
    }
    return { runId: run.id, status: run.status };
  }
}
