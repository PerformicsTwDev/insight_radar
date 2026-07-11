import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { assertOwnedRow } from '../common/owner-scope';
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
   * - 未知 `analysisId`（查無列）→ `404`（owner 過濾單點 `assertOwnedRow`，越權亦同回 404）。
   * - 存在但**尚無 snapshot**（`queued`/`running`，或尚未持久化的 `partial`/`failed`，`resultSnapshotId==null`）→
   *   `409 NOT_READY`（{@link NotReadyException}），**不回不完整誤導資料**（AC-6.4）。
   * - `resultSnapshotId` 存在（`completed` 或已持久化的 `partial`）→ 讀該不可變 snapshot（翻頁穩定）。
   */
  async loadSnapshot(analysisId: string, actor: AuthenticatedUser): Promise<SnapshotRowData[]> {
    const analysis = await this.loadAnalysis(analysisId, actor);
    if (!analysis.resultSnapshotId) {
      throw new NotReadyException(analysis.status);
    }
    return this.loadRows(analysis.resultSnapshotId);
  }

  /**
   * 讀分析行（status + resultSnapshotId + ownerId）；未知 id / 非 owner → 404。feature 狀態 + readiness 判斷
   * 之共同來源，亦為 keywords/query 兩讀取路徑的 **owner 過濾唯一單點**（T10.6，AC-27.3/27.4）：越權與未知
   * id 同回 404（不洩漏存在性），session 只見自己 + 共享（null）列、apiKey 機器 actor 不過濾。
   */
  private async loadAnalysis(
    analysisId: string,
    actor: AuthenticatedUser,
  ): Promise<AnalysisFeatureInput> {
    const analysis = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: { status: true, resultSnapshotId: true, ownerId: true },
    });
    // 未知 id 與越權同回 404（不洩漏存在性）；通過後 analysis 收斂為非 null。
    assertOwnedRow(analysis, actor, `Analysis ${analysisId} not found`);
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
    actor: AuthenticatedUser,
  ): Promise<KeywordsListResponse> {
    // 單頁上限對 /keywords 亦適用（與 POST /query 一致，config.ts / .env.example）——避免回無上限整份 snapshot（M6-R2）。
    this.assertPageSizeWithinMax(pagination.pageSize);
    const rows = await this.loadSnapshot(analysisId, actor);
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

  /** `pageSize` > 設定上限 → 結構化 400（對齊 QueryViewService；`/keywords` 與 `/query` 同上限）。 */
  private assertPageSizeWithinMax(pageSize: number | undefined): void {
    if (pageSize !== undefined && pageSize > this.config.maxPageSize) {
      throw new BadRequestException({
        code: 'QUERY_VALIDATION_FAILED',
        message: 'Query validation failed',
        fields: { pageSize: [`pageSize ${pageSize} exceeds max ${this.config.maxPageSize}`] },
      });
    }
  }

  /**
   * 載入 snapshot → 經 view-router 查詢（`POST /query`，limits 取自 queryConfig）。除基底 readiness（未知
   * id→404、無 snapshot→409 NOT_READY）外，另做 **feature-gating**（T6.8，AC-14.7）：view 依賴的 compute
   * feature（`serp`/`topics`）未 ready → 409 `FEATURE_NOT_READY`（而非誤導空表）。
   */
  async query(
    analysisId: string,
    request: QueryRequest,
    actor: AuthenticatedUser,
  ): Promise<ViewResult> {
    const analysis = await this.loadAnalysis(analysisId, actor);
    if (!analysis.resultSnapshotId) {
      throw new NotReadyException(analysis.status);
    }
    const features = computeFeatures(analysis);
    // 未知 view → 400、view 依賴的 feature 未 ready → 409，**先於** loadRows——gated view 不白抓整份 snapshot（M6-R6）。
    this.viewService.assertExecutable(request.view, features);
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
