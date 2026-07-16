import { Injectable } from '@nestjs/common';
import { normalizeText } from '../google-ads/normalize';
import { PrismaService } from '../prisma';
import type { StagedKeyword } from './journey-postprocess';
import type { JourneyStage } from './journey.schema';

/**
 * 購買歷程分類 snapshot-scoped 持久化（T12.5，FR-33/AC-33.5）。寫入獨立表 `keyword_journey_assignments`，
 * **不覆寫** `keyword_intents`（分表互補，S10）。同 snapshot 重跑以 upsert 覆寫 stage；以 normalizedText 去重
 * （與去重/快取同一套 key）。跨 snapshot 的 keyword→stage 記憶另由 Redis 快取承擔（見 {@link JourneyCache}）。
 */
@Injectable()
export class JourneyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** upsert 一批 snapshot-scoped 分類（PK = [snapshotId, normalizedText]）；空輸入 → no-op。 */
  async saveAssignments(params: {
    analysisId: string;
    snapshotId: string;
    staged: StagedKeyword[];
  }): Promise<void> {
    const { analysisId, snapshotId, staged } = params;
    // 以 normalizedText 去重（最後一筆為準）——避免同一 PK 在單一 $transaction 內重覆 upsert。
    const byNt = new Map<string, JourneyStage>();
    for (const s of staged) {
      byNt.set(normalizeText(s.keyword), s.stage);
    }
    if (byNt.size === 0) {
      return;
    }

    await this.prisma.$transaction(
      [...byNt].map(([normalizedText, stage]) =>
        this.prisma.keywordJourneyAssignment.upsert({
          where: { snapshotId_normalizedText: { snapshotId, normalizedText } },
          create: { analysisId, snapshotId, normalizedText, stage },
          update: { stage },
        }),
      ),
    );
  }
}
