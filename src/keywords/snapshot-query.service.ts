import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { assertOwnedRow, ownerWhere } from '../common/owner-scope';
import { queryConfig } from '../config/query.config';
import { type AnalysisFeatureInput, computeFeatures } from '../keyword-analysis/features';
import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import { PrismaService } from '../prisma';
import { AiViewRepository } from './ai-view.repository';
import { FeatureNotReadyException } from './feature-not-ready.exception';
import { type FilterSpec, applyFilter } from './filter-spec';
import { NotReadyException } from './not-ready.exception';
import { type PageSpec, type SortSpec, selectPage } from './paginate';
import { QueryViewService } from './query-view.service';
import {
  AI_SEARCH_VIEW_NAMES,
  AI_VIEW_SOURCE,
  type QueryLimits,
  type QueryRequest,
  type ViewResult,
  customView,
} from './views';

/** 依賴 journey feature 的 view 名（僅這些 view 才查 JourneyRun + left-join stage，T12.6/AC-33.4/33.6）。 */
const JOURNEY_VIEWS = new Set<string>(['journey', 'journey_funnel']);

/** 自訂分類動態 view 名前綴（`custom:{cid}`，T12.9/AC-34.3）。 */
const CUSTOM_VIEW_PREFIX = 'custom:';

/** UUID 形狀（任一版本）——擋非 UUID cid 於 Prisma UUID 欄位（避免 P2023 → 500）。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    private readonly aiViewRepo: AiViewRepository,
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
   * 解析並回傳分析的**就緒 snapshot id**（owner-scoped，與 {@link loadSnapshot} 同一 readiness/owner 單點）：
   * 未知 id / 非 owner → 404、尚無 snapshot（queued/running…）→ 409 NOT_READY。**不載入列**——供需要
   * `snapshotId` 作 cache namespace 但欲在**載入/聚合/LLM 前**先命中快取者（per-view AI 洞察 filters-hash，
   * AC-32.2）：cache 命中即免載列、免聚合、免打 LLM。owner 過濾唯一強制點仍在 `loadAnalysis`（S8）。
   */
  async resolveReadySnapshotId(analysisId: string, actor: AuthenticatedUser): Promise<string> {
    const analysis = await this.loadAnalysis(analysisId, actor);
    if (!analysis.resultSnapshotId) {
      throw new NotReadyException(analysis.status);
    }
    return analysis.resultSnapshotId;
  }

  /**
   * dynamic view 的**資料版本 token**（AC-32.2 補正 M12-R3）：dynamic/gated view 疊在不可變 snapshot 上的
   * per-run 可變資料版本，供 AI 洞察快取 key——避免重跑（改標籤 → 新 `labelsHash` → 新 run；或 bump
   * `JOURNEY_SCHEMA_VERSION` → 新 run）後 `(snapshotId, view, filters)` 相同卻回舊 insight（60 天 TTL）。
   * - `custom:{cid}` → 最新 **completed** `CustomClassifyRun.id`；
   * - `journey`/`journey_funnel` → 最新 **completed/partial** `JourneyRun.id`（journey 終態含 partial）；
   * - static view（keywords 等）→ `''`（資料＝不可變 snapshot、snapshotId 已定版，免 DB round-trip）。
   *
   * **用 completed（非「最新 run」）**：run 於*建立*時即改 id 但其 assignments 要*完成*才落表——用 completed
   * 才與物化資料同步（避免「版本先於資料」翻轉致重跑後再度回舊 insight）。
   */
  async resolveViewDataVersion(analysisId: string, view: string): Promise<string> {
    if (view.startsWith(CUSTOM_VIEW_PREFIX)) {
      const cid = view.slice(CUSTOM_VIEW_PREFIX.length);
      // 非 UUID cid → 直接回 ''（避免 Prisma UUID 欄位 P2023 → 500；比照 queryCustomView 的 UUID_RE 守衛，M12-R3 blocker）。
      if (!UUID_RE.test(cid)) {
        return '';
      }
      // owner-scope（S8 精神）：以 run 自身的 keywordAnalysisId 綁定 → cid 不屬此分析 → 無匹配 run → ''（版本 lookup
      // 不越權讀外分析的 run；cache-miss 時後續 query() 仍以單點 404）。keywordAnalysisId 有 @@index。
      const run = await this.prisma.customClassifyRun.findFirst({
        where: { classificationId: cid, keywordAnalysisId: analysisId, status: 'completed' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      return run?.id ?? '';
    }
    if (JOURNEY_VIEWS.has(view)) {
      const run = await this.prisma.journeyRun.findFirst({
        where: { keywordAnalysisId: analysisId, status: { in: ['completed', 'partial'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      return run?.id ?? '';
    }
    if (AI_SEARCH_VIEW_NAMES.has(view)) {
      // AI Search view 的資料版本＝最新 completed/partial linked `AiSearchRun.id`（比照 journey/custom 動態 view，
      // Design §18.4 ⑤）：bump `AI_*_SCHEMA_VERSION`（→ 新 run）後 `(snapshotId, view, filters)` 相同亦得新版本、
      // 不回舊 insight（60 天 TTL）。partial 亦落庫（某渠道 async 到達）→ 與 gate 的 ready 集一致。
      const run = await this.prisma.aiSearchRun.findFirst({
        where: { keywordAnalysisId: analysisId, status: { in: ['completed', 'partial'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      return run?.id ?? '';
    }
    return '';
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
    const limits: QueryLimits = {
      maxPageSize: this.config.maxPageSize,
      aggMaxBuckets: this.config.aggMaxBuckets,
      aggMaxGroups: this.config.aggMaxGroups,
    };
    // 自訂分類**動態 view**（`custom:{cid}`，T12.9/AC-34.3）：registry 無此 view（per-cid、boot 凍結不可註冊），
    // 動態解析（Option a）——owner 已由 loadAnalysis 驗分析，此處驗 cid 屬性 + readiness + left-join label。
    if (request.view.startsWith(CUSTOM_VIEW_PREFIX)) {
      return this.queryCustomView(analysisId, analysis.resultSnapshotId, request, limits);
    }
    // AI Search view（T15.8b/#678 G2）：讀 T15.5 落庫（keyed by 最新 completed/partial linked run），gate 隨
    // 真實資料翻轉（owner-scoped run 推導 `ai_search` feature；未 ready→409、非誤導空表 INV-6）。owner 已由
    // loadAnalysis 驗分析；run 另 owner-scoped（shared analysis 下他 session 的 run 不外洩，S8/S25）。
    if (AI_SEARCH_VIEW_NAMES.has(request.view)) {
      return this.queryAiSearchView(analysis, analysisId, request, limits, actor);
    }
    // journey view/漏斗依賴 journey feature（AC-33.6）：**僅** 該類 view 才查最新 JourneyRun 狀態（其餘 view
    // 免此開銷）；未接 run → not_generated → gate 擋（409）。
    const needsJourney = JOURNEY_VIEWS.has(request.view);
    const journeyStatus = needsJourney ? await this.latestJourneyStatus(analysisId) : undefined;
    const features = computeFeatures(analysis, { journeyStatus });
    // 未知 view → 400、view 依賴的 feature 未 ready → 409，**先於** loadRows——gated view 不白抓整份 snapshot（M6-R6）。
    this.viewService.assertExecutable(request.view, features);
    let rows = await this.loadRows(analysis.resultSnapshotId);
    // journey 的 `stage` 不在 snapshot row：以 normalizedText left-join `keyword_journey_assignments` 帶入（AC-33.4）。
    if (needsJourney) {
      rows = await this.mergeJourneyStage(analysis.resultSnapshotId, rows);
    }
    return this.viewService.query(rows, request, limits, features);
  }

  /**
   * 自訂分類動態 view 的解析 + 查詢（T12.9/AC-34.3）。cid 未知 / 不屬此分析 / 非 UUID → **404**（analysis owner
   * 已於 loadAnalysis 驗，cid 屬性再驗）；無 completed classify run → **409 `FEATURE_NOT_READY`（custom）**；
   * 就緒 → 動態產生 `customView(cid)`、以 normalizedText left-join `keyword_custom_assignments`（by classificationId）
   * 帶入 `label`，交 `queryWithView`（繞過 registry.get；白名單/build 共用單點）。
   */
  private async queryCustomView(
    analysisId: string,
    snapshotId: string,
    request: QueryRequest,
    limits: QueryLimits,
  ): Promise<ViewResult> {
    const cid = request.view.slice(CUSTOM_VIEW_PREFIX.length);
    // 非 UUID cid 直接視為未知（避免 Prisma UUID 欄位 P2023 → 500）。
    const classification = UUID_RE.test(cid)
      ? await this.prisma.customClassification.findUnique({
          where: { id: cid },
          select: { analysisId: true },
        })
      : null;
    if (!classification || classification.analysisId !== analysisId) {
      throw new NotFoundException(`custom classification ${cid} not found`);
    }
    // readiness gate（per-cid，不走 FeatureKey）：無 completed classify run → 409。
    const status = await this.latestCustomRunStatus(cid);
    if (status !== 'completed') {
      throw new FeatureNotReadyException('custom', status ?? 'not_generated');
    }
    let rows = await this.loadRows(snapshotId);
    rows = await this.mergeCustomLabel(cid, rows);
    return this.viewService.queryWithView(rows, request, limits, customView(cid));
  }

  /**
   * AI Search view 的解析 + 查詢（T15.8b/#678 G2；FR-44/AC-44.2）。gate 隨真實資料翻轉：以最新 **linked**
   * `AiSearchRun`（owner-scoped，S8/S25）推導 `ai_search` feature——未 ready（無 run/running/failed/canceled）→
   * `assertExecutable` 拋 409 `FEATURE_NOT_READY`（**先於**載入，非誤導空表 INV-6）；ready（completed/partial）→
   * 由 {@link AI_VIEW_SOURCE} 載入該 run.id 的 T15.5 落庫列（`ai_answers`/`ai_cited_references`/
   * `ai_visibility_metrics`）注入 `ctx.rows`，交 `queryWithView`（白名單/build 共用單點）套統一 `FilterSpec`。
   */
  private async queryAiSearchView(
    analysis: AnalysisFeatureInput,
    analysisId: string,
    request: QueryRequest,
    limits: QueryLimits,
    actor: AuthenticatedUser,
  ): Promise<ViewResult> {
    // 最新 linked run（owner-scoped，鏡射 getStatus 的 G1 推導）；gate 依其 status（partial/completed→ready）。
    const run = await this.aiViewRepo.findLatestLinkedRun(analysisId, ownerWhere(actor));
    const features = computeFeatures(analysis, { aiSearchStatus: run?.status });
    // 未 ready → 拋 409（先於載入，gated view 不白抓落庫，M6-R6 精神）；ready → 回解析出的 view def。
    const view = this.viewService.assertExecutable(request.view, features);
    // ready（completed/partial）⟹ run 非 null（`aiSearchFeatureStatus` 僅該兩態→ready，assertExecutable 已擋
    // 其餘）；此分支理論不可達，僅為收斂型別（TS narrowing）+ 防禦。
    if (!run) {
      throw new FeatureNotReadyException('ai_search', 'not_generated');
    }
    const rows = await this.loadAiRows(request.view, run.id);
    return this.viewService.queryWithView(rows, request, limits, view);
  }

  /**
   * 依 {@link AI_VIEW_SOURCE} 載入某 AI view 的 T15.5 落庫列（keyed by jobId＝ready run.id）。回列以
   * `SnapshotRowData[]` 收斂（動態讀取層之列非 snapshot 列，由對應 AI view `build` 以 `as unknown` 還原其型別）。
   */
  private async loadAiRows(view: string, jobId: string): Promise<SnapshotRowData[]> {
    const source = AI_VIEW_SOURCE[view];
    switch (source.table) {
      case 'answers':
        return (await this.aiViewRepo.findAnswers(jobId)) as unknown as SnapshotRowData[];
      case 'cited':
        return (await this.aiViewRepo.findCited(jobId)) as unknown as SnapshotRowData[];
      case 'metrics':
        // metrics view 必帶 dimension（AI_VIEW_SOURCE 定義保證）；keyword/intent/journey 篩選（AC-43.3）。
        return (await this.aiViewRepo.findMetrics(
          jobId,
          source.dimension ?? 'keyword',
        )) as unknown as SnapshotRowData[];
    }
  }

  /** 取某分類定義最新 CustomClassifyRun 的 status（無→undefined；供 custom view readiness gate，AC-34.3）。 */
  private async latestCustomRunStatus(classificationId: string): Promise<string | undefined> {
    const run = await this.prisma.customClassifyRun.findFirst({
      where: { classificationId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    return run?.status;
  }

  /** 以 normalizedText left-join `keyword_custom_assignments`（by classificationId）把 `label` 併入 snapshot 列。 */
  private async mergeCustomLabel(
    classificationId: string,
    rows: SnapshotRowData[],
  ): Promise<SnapshotRowData[]> {
    const assignments = await this.prisma.keywordCustomAssignment.findMany({
      where: { classificationId },
      select: { normalizedText: true, label: true },
    });
    const labelByNt = new Map(assignments.map((a) => [a.normalizedText, a.label]));
    return rows.map(
      (row) => ({ ...row, label: labelByNt.get(row.normalizedText) }) as SnapshotRowData,
    );
  }

  /** 取某分析最新 JourneyRun 的 status（無→undefined；供 journey feature 推導，AC-33.6）。 */
  private async latestJourneyStatus(analysisId: string): Promise<string | undefined> {
    const run = await this.prisma.journeyRun.findFirst({
      where: { keywordAnalysisId: analysisId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    return run?.status;
  }

  /** 以 normalizedText left-join `keyword_journey_assignments` 把 `stage` 併入 snapshot 列（未分類字 → stage 缺）。 */
  private async mergeJourneyStage(
    snapshotId: string,
    rows: SnapshotRowData[],
  ): Promise<SnapshotRowData[]> {
    const assignments = await this.prisma.keywordJourneyAssignment.findMany({
      where: { snapshotId },
      select: { normalizedText: true, stage: true },
    });
    const stageByNt = new Map(assignments.map((a) => [a.normalizedText, a.stage]));
    return rows.map(
      (row) => ({ ...row, stage: stageByNt.get(row.normalizedText) }) as SnapshotRowData,
    );
  }
}
