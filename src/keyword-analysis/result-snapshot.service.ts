import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import { computeChecksum, type SnapshotRowData } from './result-snapshot.checksum';

export interface SaveResultOutcome {
  /** 既有/新建 snapshot id；已 canceled/failed 終態（不固化）→ `null`。 */
  resultSnapshotId: string | null;
  count: number;
  checksum: string;
}

/** 終態（§6.8）：到此 `saveResult` 不再固化/覆寫（completed 回既有；canceled/failed 不轉 completed）。 */
const TERMINAL_STATUSES = new Set<JobStatus>(['completed', 'failed', 'canceled']);

/**
 * 完成時的終態進度（M3-R5）。與 `status='completed'` **同筆原子寫入**：processor 在 saveResult 後才報
 * intent/100，但屆時 status 已終態 → 其 DB 鏡像 no-op，故 completed job 的 DB progress 須在此處落地，
 * 否則永遠停在 processor 最後一筆 metrics/60（FR-8 輪詢以 DB 為真實來源 → 「completed 但 60%」自相矛盾）。
 */
const COMPLETED_PROGRESS = { phase: 'intent', percent: 100 } as const;

/**
 * 結果快照固化（T3.10，FR-6/NFR-7）：把分析結果列寫成**不可變** `ResultSnapshot`（content-addressed
 * checksum + keywordCount **落 DB**，非僅 Redis）+ `SnapshotRow`，並回填 `KeywordAnalysis.resultSnapshotId`
 * （FK）與 `status='completed'`。三寫於單一交易內原子完成（NFR-7：snapshot 落地後不漂移）。
 *
 * 註：Redis 加速讀取為 M4 快取範疇；DB 為持久後備與真實來源。
 */
@Injectable()
export class ResultSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async saveResult(analysisId: string, rows: SnapshotRowData[]): Promise<SaveResultOutcome> {
    const checksum = computeChecksum(rows);
    const keywordCount = rows.length;
    const snapshotId = randomUUID();

    // 終態守門 + 固化於**同一互動式交易**（M3-R3，TOCTOU 原子化，§6.8 終態不可逆）：
    // - 進場已終態：completed+snapshot → 回既有（重試冪等，M2）；canceled/failed → no-op、不固化。
    // - 中途被 cancel/fail：末筆**條件 updateMany（status notIn terminal）**命中 0 列 → 拋出回滾
    //   （不留孤兒 snapshot），catch 後回讀現狀。避免 cancel-vs-processor resurrection。
    const outcome = await this.prisma
      .$transaction(async (tx) => {
        const existing = await tx.keywordAnalysis.findUnique({
          where: { id: analysisId },
          select: {
            status: true,
            resultSnapshot: { select: { id: true, keywordCount: true, checksum: true } },
          },
        });
        if (existing && TERMINAL_STATUSES.has(existing.status)) {
          return terminalOutcomeFrom(existing.resultSnapshot);
        }

        await tx.resultSnapshot.create({
          data: { id: snapshotId, analysisId, keywordCount, checksum },
        });
        await tx.snapshotRow.createMany({
          data: rows.map((data, rowIndex) => ({
            snapshotId,
            analysisId,
            rowIndex,
            data: data as unknown as Prisma.InputJsonValue,
          })),
        });
        const { count } = await tx.keywordAnalysis.updateMany({
          where: { id: analysisId, status: { notIn: [...TERMINAL_STATUSES] } },
          data: {
            resultSnapshotId: snapshotId,
            status: 'completed',
            finishedAt: new Date(),
            progress: COMPLETED_PROGRESS,
          },
        });
        if (count === 0) {
          throw new TerminalRaceError(); // 中途終態 → 回滾整筆固化
        }
        return { resultSnapshotId: snapshotId, count: keywordCount, checksum };
      })
      .catch((error: unknown) => {
        if (error instanceof TerminalRaceError) {
          return null; // 回滾後於 tx 外回讀現狀
        }
        throw error;
      });

    if (outcome) {
      return outcome;
    }
    const row = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: { resultSnapshot: { select: { id: true, keywordCount: true, checksum: true } } },
    });
    return terminalOutcomeFrom(row?.resultSnapshot ?? null);
  }
}

/** 固化交易中途偵測到終態（updateMany 命中 0 列）→ 拋此以回滾整筆固化（不留孤兒 snapshot）。 */
class TerminalRaceError extends Error {}

/** 既有 snapshot → 回既有 outcome；無 → no-op（canceled/failed 不固化）。 */
function terminalOutcomeFrom(
  snapshot: { id: string; keywordCount: number; checksum: string } | null,
): SaveResultOutcome {
  return snapshot
    ? { resultSnapshotId: snapshot.id, count: snapshot.keywordCount, checksum: snapshot.checksum }
    : { resultSnapshotId: null, count: 0, checksum: '' };
}
