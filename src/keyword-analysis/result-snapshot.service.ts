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
