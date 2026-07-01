import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { queryConfig } from '../config/query.config';
import { type AnalysisFeatureInput, computeFeatures } from '../keyword-analysis/features';
import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import { PrismaService } from '../prisma';
import { type FilterSpec, applyFilter } from './filter-spec';
import { NotReadyException } from './not-ready.exception';
import { type PageSpec, type SortSpec, selectPage } from './paginate';
import { QueryViewService } from './query-view.service';
import type { QueryRequest, ViewResult } from './views';

/** `GET /keywords` 的結果列（Design §6.4 / AC-6.1；snapshot 的 `intent` → 對外 `intentLabels`）。 */
export interface KeywordListRow {
  text: string;
  intentLabels: string[];
  avgMonthlySearches: number | null;
  competition: string;
  competitionIndex: number | null;
  cpcLow: number | null;
  cpcHigh: number | null;
}

/** `GET /keywords` 回應（Design §6.4）：`{ data, meta }`。 */
export interface KeywordsListResponse {
  data: KeywordListRow[];
  meta: { total: number; page: number; pageSize: number; cursor: string | null };
}

/** snapshot 列 → §6.4 五欄結果列（`intent` 對外命名為 `intentLabels`；缺值保持 null，缺值≠0）。 */
function toResultRow(row: SnapshotRowData): KeywordListRow {
  return {
    text: row.text,
    intentLabels: row.intent,
    avgMonthlySearches: row.avgMonthlySearches,
    competition: row.competition,
    competitionIndex: row.competitionIndex,
    cpcLow: row.cpcLow,
    cpcHigh: row.cpcHigh,
  };
}

/**
 * 讀取層入口（T5.5，FR-14，Design §6.5）：載入分析的**不可變** snapshot → 交 view-router 查詢。
 * `loadSnapshot` 讀 DB（真實來源）；`query` = load + route（白名單/上限違反 → 400 由 QueryViewService 拋）。
 */
@Injectable()
export class SnapshotQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly viewService: QueryViewService,
    @Inject(queryConfig.KEY) private readonly config: ConfigType<typeof queryConfig>,
  ) {}

  /**
   * 讀分析的**不可變** snapshot 列（依 `rowIndex` 序），並在載入前分類 readiness（T6.3，AC-6.4/6.5）：
   * - 未知 `analysisId`（查無列）→ `404`（{@link NotFoundException}）。
   * - 存在但**尚無 snapshot**（`queued`/`running`，或尚未持久化的 `partial`/`failed`，`resultSnapshotId==null`）→
   *   `409 NOT_READY`（{@link NotReadyException}），**不回不完整誤導資料**（AC-6.4）。
   * - `resultSnapshotId` 存在（`completed` 或已持久化的 `partial`）→ 讀該不可變 snapshot（翻頁穩定）。
   */
  async loadSnapshot(analysisId: string): Promise<SnapshotRowData[]> {
    const analysis = await this.loadAnalysis(analysisId);
    if (!analysis.resultSnapshotId) {
      throw new NotReadyException(analysis.status);
    }
    return this.loadRows(analysis.resultSnapshotId);
  }

  /** 讀分析行（status + resultSnapshotId）；未知 id → 404。feature 狀態 + readiness 判斷之共同來源。 */
  private async loadAnalysis(analysisId: string): Promise<AnalysisFeatureInput> {
    const analysis = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: { status: true, resultSnapshotId: true },
    });
    if (!analysis) {
      throw new NotFoundException(`Analysis ${analysisId} not found`);
    }
    return analysis;
  }

  /** 讀某 snapshot 的列（依 `rowIndex` 序）。 */
  private async loadRows(snapshotId: string): Promise<SnapshotRowData[]> {
    const rows = await this.prisma.snapshotRow.findMany({
      where: { snapshotId },
      orderBy: { rowIndex: 'asc' },
      select: { data: true },
    });
    return rows.map((row) => row.data as unknown as SnapshotRowData);
  }

  /**
   * `GET /keywords` 列表（T6.1，FR-3/4/6/7，Design §6.4/§6.5）：`loadSnapshot` → `applyFilter`（共用 predicate）
   * → `selectPage`（keyset 分頁）→ §6.4 `{ data, meta }`（`intent` 對外 `intentLabels`）。**不**經 view-router
   * envelope（那是 `POST /query`）；min>max / 非法 enum 由 query DTO 於 controller 前把關（→ 400）。
   */
  async listKeywords(
    analysisId: string,
    filter: FilterSpec,
    sort: SortSpec,
    pagination: PageSpec,
  ): Promise<KeywordsListResponse> {
    const rows = await this.loadSnapshot(analysisId);
    const page = selectPage(applyFilter(rows, filter), sort, pagination);
    return {
      data: page.rows.map(toResultRow),
      meta: {
        total: page.meta.total,
        page: page.meta.page,
        pageSize: page.meta.pageSize,
        cursor: page.meta.cursor,
      },
    };
  }

  /**
   * 載入 snapshot → 經 view-router 查詢（`POST /query`，limits 取自 queryConfig）。除基底 readiness（未知
   * id→404、無 snapshot→409 NOT_READY）外，另做 **feature-gating**（T6.8，AC-14.7）：view 依賴的 compute
   * feature（`serp`/`topics`）未 ready → 409 `FEATURE_NOT_READY`（而非誤導空表）。
   */
  async query(analysisId: string, request: QueryRequest): Promise<ViewResult> {
    const analysis = await this.loadAnalysis(analysisId);
    if (!analysis.resultSnapshotId) {
      throw new NotReadyException(analysis.status);
    }
    const features = computeFeatures(analysis);
    const rows = await this.loadRows(analysis.resultSnapshotId);
    return this.viewService.query(
      rows,
      request,
      {
        maxPageSize: this.config.maxPageSize,
        aggMaxBuckets: this.config.aggMaxBuckets,
        aggMaxGroups: this.config.aggMaxGroups,
      },
      features,
    );
  }
}
