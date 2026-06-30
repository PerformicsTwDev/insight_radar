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
    // 已終態（§6.8）不固化/不覆寫——終態不可逆：
    // - completed + 既有 snapshot → 回既有（BullMQ job 重試冪等，M2；否則孤兒 rows + FK 漂移）；
    // - canceled / failed → **不**轉 completed（cancel-vs-processor race：取消後 active job 仍跑完）。
    const existing = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: {
        status: true,
        resultSnapshot: { select: { id: true, keywordCount: true, checksum: true } },
      },
    });
    if (existing && TERMINAL_STATUSES.has(existing.status)) {
      const snap = existing.resultSnapshot;
      return snap
        ? { resultSnapshotId: snap.id, count: snap.keywordCount, checksum: snap.checksum }
        : { resultSnapshotId: null, count: 0, checksum: '' };
    }

    const checksum = computeChecksum(rows);
    const keywordCount = rows.length;
    const snapshotId = randomUUID();

    await this.prisma.$transaction([
      this.prisma.resultSnapshot.create({
        data: { id: snapshotId, analysisId, keywordCount, checksum },
      }),
      this.prisma.snapshotRow.createMany({
        data: rows.map((data, rowIndex) => ({
          snapshotId,
          analysisId,
          rowIndex,
          data: data as unknown as Prisma.InputJsonValue,
        })),
      }),
      this.prisma.keywordAnalysis.update({
        where: { id: analysisId },
        data: { resultSnapshotId: snapshotId, status: 'completed', finishedAt: new Date() },
      }),
    ]);

    return { resultSnapshotId: snapshotId, count: keywordCount, checksum };
  }
}
