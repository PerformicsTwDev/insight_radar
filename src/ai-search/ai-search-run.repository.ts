import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import type { AiSearchRunStatus, AiSearchRunView } from './ai-search-run.types';

/** 建立 AiSearchRun 的輸入（params 為已序列化 Json）。 */
export interface CreateAiSearchRunInput {
  ownerId: string | null;
  idempotencyKey: string;
  params: Prisma.InputJsonValue;
  progress?: Prisma.InputJsonValue;
}

/** createRun 結果：`created=false` 代表 idempotency 命中既有 run（不重跑）。 */
export interface CreateAiSearchRunResult {
  runId: string;
  created: boolean;
}

/** markStatus 的可選終態欄位（僅提供者更新；undefined 由 Prisma 略過、不覆寫）。 */
export interface AiSearchRunOutcome {
  captureCount?: number;
  error?: string | null;
}

/**
 * AI Search 抓取 run 持久層（T14.6，FR-41/AC-41.x；仿 JourneyRunRepository）。AiSearchRun 生命週期
 * （create/idempotency/status/progress）。合流落列（`ai_search_captures`）由 {@link AiSearchCaptureRepository}——本 repo
 * 只管 run 中繼。
 */
@Injectable()
export class AiSearchRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 建立抓取 run（狀態 queued）。idempotency：`idempotencyKey` 命中既有 → 回既有 runId（`created=false`），不重建。
   * 並發同 key（都未先查到）以 DB `@unique` 為最終仲裁（P2002 → 回既有，NFR-8 並發下仍 idempotent）。
   * terminal-failed/canceled → reset 為 queued（沿用同一 runId）、回 `created=true` 使服務重跑（比照 journey M12-R1）。
   */
  async createRun(input: CreateAiSearchRunInput): Promise<CreateAiSearchRunResult> {
    const existing = await this.prisma.aiSearchRun.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (existing.status === 'failed' || existing.status === 'canceled') {
        await this.prisma.aiSearchRun.update({
          where: { id: existing.id },
          data: { status: 'queued', progress: {}, error: null, captureCount: null },
        });
        return { runId: existing.id, created: true };
      }
      return { runId: existing.id, created: false };
    }
    try {
      const run = await this.prisma.aiSearchRun.create({
        data: {
          ownerId: input.ownerId,
          status: 'queued',
          params: input.params,
          progress: input.progress ?? {},
          idempotencyKey: input.idempotencyKey,
        },
      });
      return { runId: run.id, created: true };
    } catch (error) {
      // 慢路徑：並發同 key 撞 @unique（P2002）→ 回既有（不拋）。尊重 idempotency 視窗（#311：不無條件回舊）——
      // 但抓取 run 無 TTL 視窗（idempotency 綁 owner+語意輸入+schemaVersion，bump 即新 run），故命中即回既有。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const row = await this.prisma.aiSearchRun.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
        });
        return { runId: row.id, created: false };
      }
      throw error;
    }
  }

  /** 取某 idempotencyKey 的 run（無則 null）。 */
  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<{ id: string; status: string } | null> {
    return this.prisma.aiSearchRun.findUnique({
      where: { idempotencyKey },
      select: { id: true, status: true },
    });
  }

  /** 更新狀態（+ 選配 captureCount/error）。undefined 欄位 Prisma 略過、不覆寫既有值。 */
  async markStatus(
    runId: string,
    status: AiSearchRunStatus,
    outcome: AiSearchRunOutcome = {},
  ): Promise<void> {
    await this.prisma.aiSearchRun.update({
      where: { id: runId },
      data: { status, captureCount: outcome.captureCount, error: outcome.error },
    });
  }

  /** 更新進度（SSE / GET 回報）。 */
  async updateProgress(runId: string, progress: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.aiSearchRun.update({ where: { id: runId }, data: { progress } });
  }

  /** 取某 run（GET / SSE；無→null）。owner 過濾由 service 層施加（S8）。 */
  async findById(runId: string): Promise<AiSearchRunView | null> {
    const run = await this.prisma.aiSearchRun.findUnique({ where: { id: runId } });
    if (!run) {
      return null;
    }
    return {
      id: run.id,
      ownerId: run.ownerId,
      status: run.status,
      progress: run.progress,
      captureCount: run.captureCount,
    };
  }
}
