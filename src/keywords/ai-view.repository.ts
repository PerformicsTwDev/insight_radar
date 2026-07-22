import { Injectable } from '@nestjs/common';
import type { OwnerScopeWhere } from '../common/owner-scope';
import type { VisibilityDimension } from '../ai-visibility/visibility-metrics';
import { PrismaService } from '../prisma';
import type { AiAnswerReadRow, AiCitedReadRow, AiMetricReadRow } from './views/ai-view-shape';

/** 最新 linked `AiSearchRun` 的投影（gate 推導 + 資料來源 job id）。 */
export interface LinkedAiRunRef {
  id: string;
  status: string;
}

/**
 * AI Search 讀取層持久查詢（T15.8b，#678 G2；FR-44/AC-44.1~44.3）。SnapshotQueryService 注入此 repo 讀 T15.5
 * 落庫（`ai_answers`/`ai_cited_references`/`ai_visibility_metrics`），keyed by 最新 completed/partial linked
 * `AiSearchRun.id`（owner-scoped，S8/S25）。**只讀**——落庫由 T15.5 `AiAnalysisRepository`（分析 job）負責。
 */
@Injectable()
export class AiViewRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 取某 analysis **最新 linked** `AiSearchRun`（owner-scoped，鏡射 `KeywordAnalysisService.getStatus` 的
   * G1 推導）。gate 依其 status（`aiSearchFeatureStatus`：completed/partial→ready）；ready 時其 `id` 即資料
   * 來源 job（clean-slate by jobId → 最新 linked run 即當前物化資料，比照 journey「最新 run」語意）。無→null。
   */
  async findLatestLinkedRun(
    analysisId: string,
    ownerScope: OwnerScopeWhere,
  ): Promise<LinkedAiRunRef | null> {
    const run = await this.prisma.aiSearchRun.findFirst({
      where: { keywordAnalysisId: analysisId, ...ownerScope },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
    return run ?? null;
  }

  /** 讀某 job 的 `ai_answers` 列（`ai_answers` view）；`brands` jsonb → string[]。 */
  async findAnswers(jobId: string): Promise<AiAnswerReadRow[]> {
    const rows = await this.prisma.aiAnswer.findMany({
      where: { jobId },
      select: {
        id: true,
        channel: true,
        query: true,
        answerText: true,
        brands: true,
        positive: true,
        negative: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      query: row.query,
      answerText: row.answerText,
      brands: (row.brands as string[] | null) ?? [],
      positive: row.positive,
      negative: row.negative,
    }));
  }

  /** 讀某 job 的 `ai_cited_references` 列（`ai_cited_media`/`ai_cited_pages` view 共用來源）。 */
  async findCited(jobId: string): Promise<AiCitedReadRow[]> {
    const rows = await this.prisma.aiCitedReference.findMany({
      where: { jobId },
      select: {
        id: true,
        channel: true,
        query: true,
        link: true,
        domain: true,
        title: true,
        mediaType: true,
      },
    });
    return rows;
  }

  /** 讀某 job 的 `ai_visibility_metrics` 列（依 dimension 篩選：keyword/intent/journey，AC-43.3）。 */
  async findMetrics(jobId: string, dimension: VisibilityDimension): Promise<AiMetricReadRow[]> {
    const rows = await this.prisma.aiVisibilityMetric.findMany({
      where: { jobId, dimension },
      select: {
        id: true,
        channel: true,
        groupKey: true,
        brand: true,
        mentions: true,
        shareOfVoice: true,
        citations: true,
        exposure: true,
      },
    });
    return rows;
  }
}
