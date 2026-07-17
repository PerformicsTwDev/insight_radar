import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma';

/**
 * 自訂分類階段二 snapshot-scoped 持久化（T12.8，FR-34/AC-34.3）。寫入獨立表 `keyword_custom_assignments`，
 * **不覆寫** `keyword_intents`（分表互補，S10）。同 classification 重跑以「刪除全部 → 批次插入」覆寫
 * （HITL 改標籤 → 新 run → 覆寫既有指派）；以 normalizedText 去重（與去重/快取同一套 key，尊重 PK
 * `[classificationId, normalizedText]`）。
 */
@Injectable()
export class CustomClassifyAssignRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 覆寫某 classification 的整批 snapshot-scoped 指派（PK = [classificationId, normalizedText]）。
   * 單一 `$transaction` 內先 `deleteMany`（清掉前一次 run 的殘留、含已消失的字）再 `createMany`；
   * 空輸入仍執行 delete（清空既有）。插入前以 normalizedText 去重（最後一筆為準）以避免同一 PK 在同一
   * 次插入內重覆——與去重/快取用同一個 key（S4）。
   */
  async saveAssignments(
    classificationId: string,
    assignments: { normalizedText: string; label: string }[],
  ): Promise<void> {
    // 以 normalizedText 去重（last-write-wins）——避免同一 PK 在單次 createMany 內重覆而違反主鍵。
    const byNt = new Map<string, string>();
    for (const a of assignments) {
      byNt.set(a.normalizedText, a.label);
    }
    const data = [...byNt].map(([normalizedText, label]) => ({
      classificationId,
      normalizedText,
      label,
    }));

    // delete → insert 同一 transaction：重跑覆寫；空輸入時 data=[] 使 createMany 為 no-op、delete 仍清空既有。
    await this.prisma.$transaction([
      this.prisma.keywordCustomAssignment.deleteMany({ where: { classificationId } }),
      this.prisma.keywordCustomAssignment.createMany({ data, skipDuplicates: true }),
    ]);
  }
}
