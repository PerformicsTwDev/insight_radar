import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import { computeChecksum, type SnapshotRowData } from './result-snapshot.checksum';

export interface SaveResultOutcome {
  resultSnapshotId: string;
  count: number;
  checksum: string;
}

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
    // 冪等（M2）：BullMQ job 重試時若分析已 completed 且有 snapshot，回既有的、不重建——
    // 否則每次重試另建一份 snapshot+rows、FK 漂移、舊 rows 變孤兒（snapshot 內容不可變，回既有即正確）。
    const existing = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: {
        status: true,
        resultSnapshot: { select: { id: true, keywordCount: true, checksum: true } },
      },
    });
    if (existing?.status === 'completed' && existing.resultSnapshot) {
      const snap = existing.resultSnapshot;
      return { resultSnapshotId: snap.id, count: snap.keywordCount, checksum: snap.checksum };
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
