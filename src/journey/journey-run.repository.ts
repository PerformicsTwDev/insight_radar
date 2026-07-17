import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import type { JourneyRunStatus, JourneyRunView } from './journey-run.types';

/** 建立 JourneyRun 的輸入（params/progress 為已序列化 Json）。 */
export interface CreateJourneyRunInput {
  keywordAnalysisId: string;
  snapshotId: string;
  idempotencyKey: string;
  params: Prisma.InputJsonValue;
  progress?: Prisma.InputJsonValue;
}

/** createRun 結果：`created=false` 代表 idempotency 命中既有 run（不重跑）。 */
export interface CreateJourneyRunResult {
  runId: string;
  created: boolean;
}

/** markStatus 的可選終態欄位（僅提供者更新；undefined 由 Prisma 略過、不覆寫）。 */
export interface JourneyRunOutcome {
  keywordCount?: number;
  error?: string | null;
}

/**
 * 購買歷程 run 持久層（T12.6，FR-33/AC-33.6；仿 TopicRepository）：JourneyRun 生命週期
 * （create/idempotency/status/progress）。每字 stage 由 {@link JourneyRepository} 寫 `keyword_journey_assignments`
 * （snapshot-scoped，AC-33.5，**不覆寫** keyword_intents）——本 repo 只管 run 中繼。
 */
@Injectable()
export class JourneyRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 建立分類 run（狀態 queued）。idempotency：`idempotencyKey` 命中既有 → 回既有 runId（`created=false`），
   * 不重複建立。並發同 key（都未先查到）以 DB `@unique` 為最終仲裁（P2002 → 回既有，NFR-8 並發下仍 idempotent）。
   */
  async createRun(input: CreateJourneyRunInput): Promise<CreateJourneyRunResult> {
    const existing = await this.prisma.journeyRun.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      // terminal-failed/canceled → 可重入列（M12-R1）：reset 為 queued（沿用同一 runId）、回 created=true 使服務重跑；
      // 其餘（queued/running/completed/partial）→ idempotent 回既有、不重跑。
      if (existing.status === 'failed' || existing.status === 'canceled') {
        await this.prisma.journeyRun.update({
          where: { id: existing.id },
          data: { status: 'queued', progress: {}, error: null, keywordCount: null },
        });
        return { runId: existing.id, created: true };
      }
      return { runId: existing.id, created: false };
    }
    try {
      const run = await this.prisma.journeyRun.create({
        data: {
          keywordAnalysisId: input.keywordAnalysisId,
          snapshotId: input.snapshotId,
          status: 'queued',
          params: input.params,
          progress: input.progress ?? {},
          idempotencyKey: input.idempotencyKey,
        },
      });
      return { runId: run.id, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const row = await this.prisma.journeyRun.findUniqueOrThrow({
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
    return this.prisma.journeyRun.findUnique({
      where: { idempotencyKey },
      select: { id: true, status: true },
    });
  }

  /** 更新狀態（+ 選配 keywordCount/error）。undefined 欄位 Prisma 略過、不覆寫既有值。 */
  async markStatus(
    runId: string,
    status: JourneyRunStatus,
    outcome: JourneyRunOutcome = {},
  ): Promise<void> {
    await this.prisma.journeyRun.update({
      where: { id: runId },
      data: { status, keywordCount: outcome.keywordCount, error: outcome.error },
    });
  }

  /** 更新進度（SSE / GET 回報）。 */
  async updateProgress(runId: string, progress: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.journeyRun.update({ where: { id: runId }, data: { progress } });
  }

  /** 取某分析的最新 run（GET 回應；無→null）。 */
  async findLatestRunByAnalysis(analysisId: string): Promise<JourneyRunView | null> {
    const run = await this.prisma.journeyRun.findFirst({
      where: { keywordAnalysisId: analysisId },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) {
      return null;
    }
    return {
      id: run.id,
      snapshotId: run.snapshotId,
      status: run.status,
      progress: run.progress,
      keywordCount: run.keywordCount,
    };
  }
}
