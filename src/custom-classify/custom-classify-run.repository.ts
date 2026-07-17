import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import type { CustomClassifyRunParams, CustomClassifyRunStatus } from './custom-classify-run.types';

/** 建立 CustomClassifyRun 的輸入（params 為型別化參數，於 Prisma 邊界序列化為 Json）。 */
export interface CreateCustomClassifyRunInput {
  classificationId: string;
  keywordAnalysisId: string;
  snapshotId: string;
  idempotencyKey: string;
  params: CustomClassifyRunParams;
}

/** createRun 結果：`created=false` 代表 idempotency 命中既有 run（不重跑）。 */
export interface CreateCustomClassifyRunResult {
  runId: string;
  created: boolean;
}

/**
 * 自訂分類階段二 run 持久層（T12.8，FR-34/AC-34.2；比照 JourneyRunRepository）：CustomClassifyRun 生命週期
 * （create/idempotency/status/progress）。每字→label 指派由 {@link CustomClassifyAssignRepository} 寫
 * `keyword_custom_assignments`（snapshot-scoped，AC-34.3，**不覆寫** keyword_intents）——本 repo 只管 run 中繼。
 */
@Injectable()
export class CustomClassifyRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 建立分類 run（狀態 queued，progress 為 null——model 的 progress 可為 null，異於 JourneyRun）。
   * idempotency：`idempotencyKey` 命中既有 → 回既有 runId（`created=false`），不重複建立。並發同 key
   * （都未先查到）以 DB `@unique` 為最終仲裁（P2002 → 回既有，NFR-8 並發下仍 idempotent）。
   */
  async createRun(input: CreateCustomClassifyRunInput): Promise<CreateCustomClassifyRunResult> {
    const existing = await this.prisma.customClassifyRun.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      // terminal-failed → 可重入列（M12-R1）：reset 為 queued（沿用同一 runId）、回 created=true 使服務重跑；
      // 其餘（queued/running/completed）→ idempotent 回既有、不重跑。
      // 非原子（findUnique + update 兩段）：兩並發呼叫可能都見 failed 並各自 reset+enqueue——但服務層以
      // jobId=runId 的 BullMQ dedup（handleDuplicatedJob）保證只有一個 job 實跑，故為「良性重複工」非正確性問題。
      if (existing.status === 'failed') {
        await this.prisma.customClassifyRun.update({
          where: { id: existing.id },
          data: { status: 'queued', progress: Prisma.DbNull, error: null, keywordCount: null },
        });
        return { runId: existing.id, created: true };
      }
      return { runId: existing.id, created: false };
    }
    try {
      const run = await this.prisma.customClassifyRun.create({
        data: {
          classificationId: input.classificationId,
          keywordAnalysisId: input.keywordAnalysisId,
          snapshotId: input.snapshotId,
          status: 'queued',
          // 型別化 params interface 無 index signature → 於 Prisma Json 邊界序列化（既有 repo 慣用做法）。
          params: input.params as unknown as Prisma.InputJsonValue,
          progress: Prisma.DbNull,
          idempotencyKey: input.idempotencyKey,
        },
      });
      return { runId: run.id, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const row = await this.prisma.customClassifyRun.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
        });
        return { runId: row.id, created: false };
      }
      throw error;
    }
  }

  /**
   * 取某 cid **進行中（queued/running）** 的 run（並發守門 M12-R8；無→null）。assignments 為 cid-scoped
   * （PK 無 runId），同 cid 兩 in-flight run 會 last-committer-wins 覆寫 → 用此擋不同 idempotencyKey 的並發 run。
   */
  async findInProgressRunByClassification(
    classificationId: string,
  ): Promise<{ id: string; idempotencyKey: string } | null> {
    return this.prisma.customClassifyRun.findFirst({
      where: { classificationId, status: { in: ['queued', 'running'] } },
      select: { id: true, idempotencyKey: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 取某 idempotencyKey 的 run（無則 null）。 */
  async findByIdempotencyKey(key: string): Promise<{ id: string; status: string } | null> {
    return this.prisma.customClassifyRun.findUnique({
      where: { idempotencyKey: key },
      select: { id: true, status: true },
    });
  }

  /** 更新狀態（+ 選配 keywordCount/error）。undefined 欄位 Prisma 略過、不覆寫既有值。 */
  async markStatus(
    runId: string,
    status: CustomClassifyRunStatus,
    extra: { keywordCount?: number; error?: string } = {},
  ): Promise<void> {
    await this.prisma.customClassifyRun.update({
      where: { id: runId },
      data: { status, keywordCount: extra.keywordCount, error: extra.error },
    });
  }

  /** 更新進度（SSE / GET 回報）。progress 為呼叫端負責可序列化的不透明 JSON。 */
  async updateProgress(runId: string, progress: unknown): Promise<void> {
    await this.prisma.customClassifyRun.update({
      where: { id: runId },
      data: { progress: progress as Prisma.InputJsonValue },
    });
  }

  /** 取某 classification 的最新 run（GET .../assignments 回應；無→null；createdAt desc）。 */
  async findLatestRunByClassification(classificationId: string): Promise<{
    id: string;
    classificationId: string;
    snapshotId: string;
    status: string;
    progress: unknown;
    keywordCount: number | null;
  } | null> {
    const run = await this.prisma.customClassifyRun.findFirst({
      where: { classificationId },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) {
      return null;
    }
    return {
      id: run.id,
      classificationId: run.classificationId,
      snapshotId: run.snapshotId,
      status: run.status,
      progress: run.progress,
      keywordCount: run.keywordCount,
    };
  }
}
