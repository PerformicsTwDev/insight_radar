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
  /** T15.8a（#678 G1）：Option A additive link → keyword-analysis（null=standalone）；於 create（created=true）落。 */
  keywordAnalysisId?: string | null;
}

/** createRun 結果：`created=false` 代表 idempotency 命中既有 run（不重跑）。 */
export interface CreateAiSearchRunResult {
  runId: string;
  created: boolean;
}

/**
 * 可 reset 重入列的終態集（M14-R3/#579 [7]，Design §18.3）：failed/canceled 外**含 partial**——AI Search 的 partial
 * ＝job 執行當時某渠道尚無 capture，而 extension capture **async 到達**，故重送應能再收（異於 journey/custom-classify
 * 的 partial＝輸入本身無法分類、屬穩定終態、不重跑）。
 */
const RESETTABLE_TERMINAL_STATUSES: AiSearchRunStatus[] = ['failed', 'canceled', 'partial'];

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
   * terminal（failed/canceled/**partial**，M14-R3/#579 [7]）→ reset 為 queued（沿用同一 runId）、回 `created=true` 使服務重跑。
   *
   * **reset 並發原子性（M14-R3/#579 [6]，Design §18.3）**：改用**條件式 `updateMany`**（`where: { id, status: { in: terminal } }`）——
   * 單 SQL row-lock 下並發同 key 兩重送**只有一個** `count===1`（贏得 terminal→queued 轉態 → created=true → 唯一 enqueue），
   * 另一個 `count===0`（該列已非 terminal）→ created=false、不重複 enqueue；比 journey/custom-classify 的非原子
   * `findUnique+update`（「良性重複工」）更嚴，於 DB 層封閉 reset 轉態的 double-enqueue 窗。
   */
  async createRun(input: CreateAiSearchRunInput): Promise<CreateAiSearchRunResult> {
    const existing = await this.prisma.aiSearchRun.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (RESETTABLE_TERMINAL_STATUSES.includes(existing.status as AiSearchRunStatus)) {
        const reset = await this.prisma.aiSearchRun.updateMany({
          where: { id: existing.id, status: { in: RESETTABLE_TERMINAL_STATUSES } },
          data: { status: 'queued', progress: {}, error: null, captureCount: null },
        });
        // count===1 → 本呼叫贏得原子轉態（唯一 enqueue）；count===0 → 並發者已 reset（回 created=false，不重複 enqueue）。
        return { runId: existing.id, created: reset.count === 1 };
      }
      return { runId: existing.id, created: false };
    }
    try {
      const run = await this.prisma.aiSearchRun.create({
        data: {
          ownerId: input.ownerId,
          // T15.8a（#678 G1）：Option A additive link（null=standalone）；於 create（created=true）落，reset 保留。
          keywordAnalysisId: input.keywordAnalysisId ?? null,
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

  /**
   * T15.8a（#678 G1）：取 keyword-analysis 的 owner 投影（供 service 層 owner-verify `analysisId` 連結，S8）。
   * 未知 → null（service 以 `assertOwnedRow` 收斂未知/越權為同一 404，不洩漏存在性）。
   */
  findAnalysisOwner(analysisId: string): Promise<{ ownerId: string | null } | null> {
    return this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: { ownerId: true },
    });
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
