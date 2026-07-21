import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma';

/** 一列 AI 回答分析結果（ai_answers）。`brands`=露出次數不去重（S17）；`positive`/`negative`=本品牌褒/貶累計。 */
export interface AiAnswerRow {
  channel: string;
  query: string;
  answerText: string;
  brands: string[];
  positive: number;
  negative: number;
}

/** 一列引用媒體分類（ai_cited_references）；`mediaType`=9-enum（AC-42.3）。 */
export interface AiCitedReferenceRow {
  channel: string;
  query: string;
  link: string;
  domain: string;
  title: string | null;
  mediaType: string;
}

/** 一列可見度指標（ai_visibility_metrics）；`AiVisibilityCell`（T15.4）攤平（`group`→`groupKey`）。 */
export interface AiVisibilityMetricRow {
  channel: string;
  dimension: string;
  groupKey: string;
  brand: string;
  mentions: number;
  shareOfVoice: number | null;
  citations: number;
  exposure: number | null;
}

/**
 * AI 分析結果持久層（T15.5，FR-42/FR-43；Design §18.4）。把三線 pipeline 衍生資料落 `ai_answers` /
 * `ai_cited_references` / `ai_visibility_metrics`（供 T15.6 view 讀取），全部以 `jobId`（=AiSearchRun.id）關聯。
 *
 * **idempotent re-run**：`deleteByJobId` clean-slate 三表既有列後再 `createMany`——reset/retry 沿用同一 jobId 不
 * 重複落列（比照 `AiSearchCaptureRepository.deleteByJobId`）。owner/schemaVersion 由 caller 帶入（每列同值）。
 */
@Injectable()
export class AiAnalysisRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 清掉本 job 三表既有分析列（reset/retry clean slate；idempotent re-run）。 */
  async deleteByJobId(jobId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.aiAnswer.deleteMany({ where: { jobId } }),
      this.prisma.aiCitedReference.deleteMany({ where: { jobId } }),
      this.prisma.aiVisibilityMetric.deleteMany({ where: { jobId } }),
    ]);
  }

  /** 落 per-answer 分析列；回落列筆數。空集 → 0（不呼叫 DB）。 */
  async persistAnswers(
    jobId: string,
    ownerId: string | null,
    schemaVersion: string,
    rows: readonly AiAnswerRow[],
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const result = await this.prisma.aiAnswer.createMany({
      data: rows.map((row) => ({
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
    return result.count;
  }

  /** 落引用媒體分類列；回落列筆數。空集 → 0（不呼叫 DB）。 */
  async persistCitedReferences(
    jobId: string,
    ownerId: string | null,
    schemaVersion: string,
    rows: readonly AiCitedReferenceRow[],
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const result = await this.prisma.aiCitedReference.createMany({
      data: rows.map((row) => ({
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
    return result.count;
  }

  /** 落可見度指標列；回落列筆數。空集 → 0（不呼叫 DB）。 */
  async persistMetrics(
    jobId: string,
    ownerId: string | null,
    schemaVersion: string,
    rows: readonly AiVisibilityMetricRow[],
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const result = await this.prisma.aiVisibilityMetric.createMany({
      data: rows.map((row) => ({
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
    return result.count;
  }
}
