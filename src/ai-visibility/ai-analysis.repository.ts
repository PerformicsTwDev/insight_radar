import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma';
import type { AiAnalysisPersistCounts, AiAnalysisRows, AiAnalysisStore } from './ai-analysis.types';

/**
 * AI 分析結果持久層（T15.5，FR-42/FR-43；Design §18.4）。把三線 pipeline 衍生資料落 `ai_answers` /
 * `ai_cited_references` / `ai_visibility_metrics`（供 T15.6 view 讀取），全部以 `jobId`（=AiSearchRun.id）關聯。
 *
 * **idempotent re-run + 原子（M15-R8/#689，INV-6）**：`replaceForJob` 於**單一 `$transaction`** 內先三表
 * `deleteMany`（reset/retry clean-slate）再三表 `createMany`——delete 與 creates 全有或全無，final attempt
 * mid-persist crash 不再跨表撕裂（比照 Journey/CustomClassify 的 `saveAssignments`）。owner/schemaVersion 由
 * caller 帶入（每列同值）。
 */
@Injectable()
export class AiAnalysisRepository implements AiAnalysisStore {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 原子覆寫本 job 三表分析列：單一 `$transaction` 內三表 `deleteMany`（clean-slate）+ 三表 `createMany`
   * （新列）。空 `rows` → 仍 delete 清舊、createMany 為 no-op（clean-slate、無新列）。回三表落列筆數。
   */
  async replaceForJob(
    jobId: string,
    ownerId: string | null,
    schemaVersion: string,
    rows: AiAnalysisRows,
  ): Promise<AiAnalysisPersistCounts> {
    // RED（M15-R8）：暫以 delete-txn + 分散 createMany 保留現況 bug（跨表非原子）。
    await this.prisma.$transaction([
      this.prisma.aiAnswer.deleteMany({ where: { jobId } }),
      this.prisma.aiCitedReference.deleteMany({ where: { jobId } }),
      this.prisma.aiVisibilityMetric.deleteMany({ where: { jobId } }),
    ]);
    const answers = await this.prisma.aiAnswer.createMany({
      data: rows.answers.map((row) => ({
        ownerId,
        jobId,
        channel: row.channel,
        query: row.query,
        answerText: row.answerText,
        brands: row.brands,
        positive: row.positive,
        negative: row.negative,
        schemaVersion,
      })),
    });
    const cited = await this.prisma.aiCitedReference.createMany({
      data: rows.cited.map((row) => ({
        ownerId,
        jobId,
        channel: row.channel,
        query: row.query,
        link: row.link,
        domain: row.domain,
        title: row.title,
        mediaType: row.mediaType,
        schemaVersion,
      })),
    });
    const metrics = await this.prisma.aiVisibilityMetric.createMany({
      data: rows.metrics.map((row) => ({
        ownerId,
        jobId,
        channel: row.channel,
        dimension: row.dimension,
        groupKey: row.groupKey,
        brand: row.brand,
        mentions: row.mentions,
        shareOfVoice: row.shareOfVoice,
        citations: row.citations,
        exposure: row.exposure,
        schemaVersion,
      })),
    });
    return {
      answersCount: answers.count,
      citedCount: cited.count,
      metricsCount: metrics.count,
    };
  }
}
