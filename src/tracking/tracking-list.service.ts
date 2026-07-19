import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { assertOwnedRow, canAccess, ownerIdOf, ownerWhere } from '../common/owner-scope';
import { trackingConfig } from '../config/tracking.config';
import { normalizeText } from '../google-ads/normalize';
import { PrismaService } from '../prisma/prisma.service';
import { TopicRepository } from '../topics/topic.repository';
import type { ExpandedTopicMember } from '../topics/topic.repository';
import type { AddMembersDto, MemberItem } from './dto/add-members.dto';
import type { CreateTrackingListDto } from './dto/create-tracking-list.dto';
import type { RenameTrackingListDto } from './dto/rename-tracking-list.dto';
import {
  assembleVolumeSeries,
  type SeriesSnapshotInput,
  type VolumeSeriesResult,
} from './volume-series';

/** 時序讀取的時間範圍（FR-30，AC-30.1/30.3）：`fetchedAt` 含端點過濾；皆缺＝不設界（全時序）。 */
export interface SeriesRange {
  from?: Date;
  to?: Date;
}

/** 清單基本對外形狀（create/rename 回傳；list/detail 之共同面）。 */
export interface TrackingListView {
  listId: string;
  name: string;
  geo: string;
  language: string;
  createdAt: Date;
}

/** 清單列表列（FR-28，AC-28.3）：基本面 + `memberCount`（Prisma `_count`）。 */
export interface TrackingListSummary extends TrackingListView {
  memberCount: number;
}

/** 加成員回應（AC-28.4）：`added`＝實際新增數；`memberCount`＝加入後清單總成員數。 */
export interface AddMembersResult {
  memberCount: number;
  added: number;
}

/** 移除成員回應（AC-28.6）：回被移除成員的 `listId` 與（正規化後的）`normalizedText`。 */
export interface RemoveMemberResult {
  listId: string;
  normalizedText: string;
}

/** 成員基本面（FR-28；時序讀取＝FR-30/T11.7，非本任務）。 */
export interface TrackingListMemberView {
  normalizedText: string;
  text: string;
  addedAt: Date;
  lastCheckedAt: Date | null;
}

/** 清單詳情（FR-28，AC-28.3）：metadata + 成員基本面。 */
export interface TrackingListDetail extends TrackingListView {
  members: TrackingListMemberView[];
}

/** 清單列的最小共同面（create/update/detail 的映射來源）。 */
type ListRow = {
  id: string;
  name: string;
  geo: string;
  language: string;
  createdAt: Date;
};

/**
 * Postgres advisory-lock class ids（#470，並發上限守門的原子化）——以 `pg_advisory_xact_lock(class, objid)`
 * 的第一參數區隔用途，`objid=hashtext(key)`（int4）。xact 級 lock 於交易結束自動釋放（連線由互動式交易 pin，
 * pool-safe）；`hashtext` 罕見碰撞僅致額外序列化、不失正確性。
 */
const CREATE_LOCK_CLASS = 1; // per-owner：序列化同 owner 建立（清單上限 AC-28.7）
const MEMBER_LOCK_CLASS = 2; // per-list：序列化同清單加成員（成員上限 AC-28.7）
/** null owner（apiKey 機器 actor）的 advisory-lock sentinel 鍵（hashtext 不接受 NULL）。 */
const NULL_OWNER_LOCK_KEY = 'tracking:null-owner';

/**
 * TrackingListService（T11.2，FR-28）——追蹤清單 CRUD + **owner scope 強制**。
 *
 * owner 過濾唯一單點＝T10.6 helper（`ownerIdOf` 建立歸屬、`ownerWhere` 列表/計數過濾、`assertOwnedRow`
 * 單列越權/不存在同回 404）；owner **只**由已認證 actor 推導，**永不**由請求參數（`?ownerId=`）覆寫
 * （AC-27.4，強制點在此 service 層而非 controller）。`@@unique([ownerId,name])` 衝突（P2002）→ 409。
 * 無外部 API（HTTP + DB only）。
 */
@Injectable()
export class TrackingListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly topics: TopicRepository,
    @Inject(trackingConfig.KEY) private readonly config: ConfigType<typeof trackingConfig>,
  ) {}

  /**
   * 建立清單（AC-28.1/28.7）：`ownerId` 由 actor 決定（session→id、apiKey→null）；geo/language 固定於清單層
   * （AC-28.5）。**清單上限（AC-28.7）**：該 owner（`ownerId`）現有清單數 ≥ `TRACKING_MAX_LISTS` → 409（保護
   * Ads 配額，NFR-16）。同 owner 重名撞 `@@unique([ownerId,name])`（P2002）→ 409（非 P2002 錯誤原樣上拋，不誤判重複）。
   */
  async create(dto: CreateTrackingListDto, actor: AuthenticatedUser): Promise<TrackingListView> {
    const ownerId = ownerIdOf(actor);
    try {
      // 清單上限（AC-28.7）原子化（#470，create TOCTOU）：count→insert 於**單一互動式交易**內，並先取
      // **per-owner advisory lock** 序列化同 owner 並發建立——否則兩並發皆讀 count<max 後各自 insert →
      // 越過 TRACKING_MAX_LISTS（保護 Ads 配額，NFR-16）。xact lock 交易結束自動釋放。
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CREATE_LOCK_CLASS}::int4, hashtext(${ownerId ?? NULL_OWNER_LOCK_KEY}))`;
        const listCount = await tx.trackingList.count({ where: { ownerId } });
        if (listCount >= this.config.maxLists) {
          throw new ConflictException(listLimitMessage(this.config.maxLists));
        }
        const row = await tx.trackingList.create({
          data: { ownerId, name: dto.name, geo: dto.geo, language: dto.language },
        });
        return toView(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw duplicateName(dto.name);
      }
      throw error; // 非 P2002：原樣上拋，不誤判為重複（全域 filter 轉 500，比照 auth register 慣例）。
    }
  }

  /**
   * 清單列表（AC-28.3）：以 `ownerWhere(actor)` 過濾（session→自己+共享 null；apiKey→全部，AC-27.5）、
   * `createdAt desc`；每列 `memberCount` 由 Prisma `_count`（避免 N+1）。owner 僅源自 actor，`?ownerId=`
   * 無法拓寬（AC-27.4）。
   */
  async list(actor: AuthenticatedUser): Promise<TrackingListSummary[]> {
    const rows = await this.prisma.trackingList.findMany({
      where: ownerWhere(actor),
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { members: true } } },
    });
    return rows.map((row) => ({ ...toView(row), memberCount: row._count.members }));
  }

  /**
   * 清單詳情（AC-28.3）：metadata + 成員基本面（`normalizedText`/`text`/`addedAt`/`lastCheckedAt`）。
   * 越權/不存在 → **同一 404**（`assertOwnedRow`，不洩漏存在性，AC-27.3/27.4）。成員時序（VolumeSnapshot）
   * 讀取＝FR-30/T11.7，非本任務。
   */
  async getDetail(listId: string, actor: AuthenticatedUser): Promise<TrackingListDetail> {
    const row = await this.prisma.trackingList.findUnique({
      where: { id: listId },
      include: { members: { orderBy: { addedAt: 'asc' } } },
    });
    assertOwnedRow(row, actor, notFoundMessage(listId));
    return {
      ...toView(row),
      members: row.members.map((m) => ({
        normalizedText: m.normalizedText,
        text: m.text,
        addedAt: m.addedAt,
        lastCheckedAt: m.lastCheckedAt,
      })),
    };
  }

  /**
   * 搜量時序讀取（T11.7，FR-30 AC-30.1~30.5 · NFR-16）。**owner 守門先於任何時序查詢**（`assertOwnedRow`：
   * 越權/不存在 → 同一 404，唯一強制點在此 service 層而非請求參數，FR-27/S8）。載入清單成員 + 其
   * `VolumeSnapshot`（scope 至**現有成員** `normalizedText` 且依 from/to 過濾 `fetchedAt` 含端點），委派純函式
   * {@link assembleVolumeSeries} 組成 axis/total/per-member series（真實邏輯全在純函式、fully unit-covered）。
   * 無成員 → 略過快照查詢（空時序，AC-30.3）。
   */
  async getSeries(
    listId: string,
    range: SeriesRange,
    actor: AuthenticatedUser,
  ): Promise<VolumeSeriesResult> {
    const list = await this.prisma.trackingList.findUnique({
      where: { id: listId },
      include: { members: { orderBy: { addedAt: 'asc' } } },
    });
    assertOwnedRow(list, actor, notFoundMessage(listId));

    const memberKeys = list.members.map((m) => m.normalizedText);
    const snapshotSelect = {
      normalizedText: true,
      fetchedAt: true,
      avgMonthlySearches: true,
      competition: true,
      cpcLowMicros: true,
    } as const;
    // 空清單：無成員 key → 略過快照查詢（空時序，AC-30.3；亦免 `IN ()` 無謂查詢）。
    const [snapshots, latestSnapshots] =
      memberKeys.length === 0
        ? [[], []]
        : await Promise.all([
            // (a) 視窗內快照（from/to）——供 axis/series/total。
            this.prisma.volumeSnapshot.findMany({
              where: seriesWhere(listId, memberKeys, range),
              orderBy: { fetchedAt: 'asc' },
              select: snapshotSelect,
            }),
            // (b) 每成員**實際最新**一筆（**不套 from/to**，AC-30.5 成員表 latest；#471-1）。`distinct` +
            //     `orderBy` 取每 normalizedText 依 fetchedAt desc 的首列＝該成員 max-fetchedAt 快照。
            this.prisma.volumeSnapshot.findMany({
              where: { listId, normalizedText: { in: memberKeys } },
              distinct: ['normalizedText'],
              orderBy: [{ normalizedText: 'asc' }, { fetchedAt: 'desc' }],
              select: snapshotSelect,
            }),
          ]);

    // avg_monthly_searches is BIGINT (#469) → JS number at the read boundary so the pure
    // assembler + JSON contract stay number-shaped (values < 2^53 exact; null stays null).
    const toInput = (s: {
      normalizedText: string;
      fetchedAt: Date;
      avgMonthlySearches: bigint | null;
      competition: string | null;
      cpcLowMicros: bigint | null;
    }): SeriesSnapshotInput => ({
      normalizedText: s.normalizedText,
      fetchedAt: s.fetchedAt,
      avgMonthlySearches: s.avgMonthlySearches === null ? null : Number(s.avgMonthlySearches),
      competition: s.competition,
      cpcLowMicros: s.cpcLowMicros,
    });

    return assembleVolumeSeries(
      { listId: list.id, name: list.name, geo: list.geo, language: list.language },
      list.members.map((m) => ({
        normalizedText: m.normalizedText,
        text: m.text,
        addedAt: m.addedAt,
        lastCheckedAt: m.lastCheckedAt,
      })),
      snapshots.map(toInput),
      latestSnapshots.map(toInput),
    );
  }

  /**
   * 加成員（AC-28.4/28.5/28.7 · NFR-16）——T11.3。流程：
   * 0. **請求形狀守門（NFR-16 DoS）**：`items` 數 > `TRACKING_MAX_ITEMS_PER_REQUEST` → `400`。此為**第一步**、
   *    先於任何 DB 存取——因主題列展開為「每 item 沿序 ≥1 次 DB round-trip」，無上限則單一已認證請求可挾超大
   *    批次放大成應用層 DoS（連線池耗竭），故在觸及 DB 前即拒絕。
   * 1. **owner 守門**：先 `assertOwnedRow`（越權/不存在 → 同一 404；owner 唯一強制點在此 service 層，FR-27）。
   * 2. **展開攤平**：關鍵字列直接取字；主題列經 `TopicRepository.expandTopicToMembers` 展開為該分析最新
   *    topic run 中該群的**已指派非-noise** 關鍵字（AC-28.4）。每候選帶其來源 `geo`/`language` 語境。
   * 3. **語境守門（AC-28.5）**：任一候選來源 geo/language 與清單層不符 → `400`（不默默改寫語境）。
   * 4. **聯集去重（AC-28.4）**：以 `normalizedText`（S4，與去重/快取同一套）對「現有成員 ∪ 本批」去重；
   *    已存在 / 批內重複 → 不重複建立。
   * 5. **上限（AC-28.7）**：加入後成員數超過 `TRACKING_MAX_MEMBERS_PER_LIST` → `409`（整批不落）。
   * 回 `{ memberCount, added }`（`added`＝實際新增數、`memberCount`＝加入後總數，皆以 DB 為準）。
   */
  async addMembers(
    listId: string,
    dto: AddMembersDto,
    actor: AuthenticatedUser,
  ): Promise<AddMembersResult> {
    // 請求形狀守門（NFR-16 DoS）：先於任何 DB 存取，把超大批次擋在展開放大之前（連線池保護）。
    if (dto.items.length > this.config.maxItemsPerRequest) {
      throw new BadRequestException(tooManyItemsMessage(this.config.maxItemsPerRequest));
    }

    const list = await this.prisma.trackingList.findUnique({
      where: { id: listId },
      select: { id: true, ownerId: true, geo: true, language: true },
    });
    assertOwnedRow(list, actor, notFoundMessage(listId));

    const candidates = await this.expandItems(dto.items, actor);

    // 語境守門（AC-28.5）：任一展開後關鍵字來源 geo/language 與清單層不符 → 400（不默默改寫）。
    for (const candidate of candidates) {
      if (candidate.geo !== list.geo || candidate.language !== list.language) {
        throw new BadRequestException(contextMismatchMessage(list.geo, list.language));
      }
    }

    // 成員上限（AC-28.7）原子化（#470，addMembers TOCTOU）：讀現有成員 → 去重 → cap 檢查 → createMany 的
    // 關鍵段於**單一互動式交易**內，並先取 **per-list advisory lock** 序列化同清單並發加成員——否則兩並發皆
    // 讀 existing=N、各自加 k → 越過 TRACKING_MAX_MEMBERS_PER_LIST（保護 Ads 配額，NFR-16）。主題展開 / 語境
    // 守門置於交易之前（關鍵段短、不含慢查詢）。**去重本即 DB 保證**（`@@id` PK + skipDuplicates），此段只補上限原子性。
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MEMBER_LOCK_CLASS}::int4, hashtext(${listId}))`;

      // 聯集去重（AC-28.4）：以 normalizedText 對「現有成員 ∪ 本批」去重（已存在 / 批內重複 → 不重複建立）。
      const existing = new Set(
        (
          await tx.trackingListMember.findMany({
            where: { listId },
            select: { normalizedText: true },
          })
        ).map((member) => member.normalizedText),
      );
      const seen = new Set<string>();
      const toAdd: Prisma.TrackingListMemberCreateManyInput[] = [];
      for (const candidate of candidates) {
        if (existing.has(candidate.normalizedText) || seen.has(candidate.normalizedText)) {
          continue;
        }
        seen.add(candidate.normalizedText);
        toAdd.push({ listId, normalizedText: candidate.normalizedText, text: candidate.text });
      }

      // 上限（AC-28.7）：加入後成員數超過 TRACKING_MAX_MEMBERS_PER_LIST → 409（整批不落，保護 Ads 配額）。
      if (existing.size + toAdd.length > this.config.maxMembersPerList) {
        throw new ConflictException(limitMessage(this.config.maxMembersPerList));
      }

      // `@@id([listId, normalizedText])` 為聯集去重最終仲裁：skipDuplicates 讓並發同字不撞 P2002。
      const { count: added } = await tx.trackingListMember.createMany({
        data: toAdd,
        skipDuplicates: true,
      });
      const memberCount = await tx.trackingListMember.count({ where: { listId } });
      return { memberCount, added };
    });
  }

  /**
   * 移除成員（AC-28.6）——T11.4。先 `assertOwnedRow`（越權/清單不存在 → 同一 404，owner 守門先於成員查找，
   * 不洩漏存在性，FR-27）；`normalizedText` 路徑參數再經 `normalizeText`（S4，與成員 / 去重 / 快取 key 同一套）
   * 後才比對刪除；無此成員（`deleteMany` count===0）→ `404`。回 `{ listId, normalizedText }`。
   */
  async removeMember(
    listId: string,
    normalizedText: string,
    actor: AuthenticatedUser,
  ): Promise<RemoveMemberResult> {
    const list = await this.prisma.trackingList.findUnique({
      where: { id: listId },
      select: { id: true, ownerId: true },
    });
    assertOwnedRow(list, actor, notFoundMessage(listId));

    // `:normalizedText` 路徑參數再經 normalizeText（S4）後才比對，確保與成員 / 去重 / 快取 key 同一套。
    const key = normalizeText(normalizedText);
    const { count } = await this.prisma.trackingListMember.deleteMany({
      where: { listId, normalizedText: key },
    });
    if (count === 0) {
      throw new NotFoundException(memberNotFoundMessage(key));
    }
    // 連帶刪其時序快照（VolumeSnapshot 無 FK cascade）——否則同 normalizedText re-add 會復活舊快照
    // 且 storeOnChange 撞舊 latest 抑制首筆新快照（M11-R1，AC-28.6）。不受 KEEP_SERIES_ON_DELETE 影響。
    await this.prisma.volumeSnapshot.deleteMany({ where: { listId, normalizedText: key } });
    return { listId, normalizedText: key };
  }

  /**
   * 把 `items` 展開攤平為候選成員（帶來源 geo/language 語境，供語境守門）：關鍵字列 `normalizedText` 由
   * 伺服器 `normalizeText(text)` 導出（S4，不由 client 給）；主題列經 `TopicRepository.expandTopicToMembers`
   * 展開為該群非-noise 關鍵字（無此群 / 無 run → 空集合，AC-28.4）。**`analysisId` 受 owner-scope（FR-27）**：
   * actor 不可存取（他人 owner）或不存在的分析 → 該 item 展開為**空集合**（與不存在不可區分，不跨 owner 讀）。
   */
  private async expandItems(
    items: MemberItem[],
    actor: AuthenticatedUser,
  ): Promise<ExpandedTopicMember[]> {
    const candidates: ExpandedTopicMember[] = [];
    for (const item of items) {
      if (item.kind === 'keyword') {
        candidates.push({
          normalizedText: normalizeText(item.text),
          text: item.text,
          geo: item.geo,
          language: item.language,
        });
      } else if (await this.canAccessAnalysis(item.analysisId, actor)) {
        candidates.push(
          ...(await this.topics.expandTopicToMembers(item.analysisId, item.topicName)),
        );
      }
      // 不可存取 / 不存在的 topic analysisId → 不展開（空集合，FR-27，不洩漏存在性）。
    }
    return candidates;
  }

  /** topic item 的 `analysisId` owner 守門（FR-27）：不存在 → false；apiKey→全可；session→自己或共享(null)。 */
  private async canAccessAnalysis(analysisId: string, actor: AuthenticatedUser): Promise<boolean> {
    const analysis = await this.prisma.keywordAnalysis.findUnique({
      where: { id: analysisId },
      select: { ownerId: true },
    });
    return analysis !== null && canAccess(analysis, actor);
  }

  /**
   * 改名（AC-28.2）：先 `assertOwnedRow`（越權/不存在→404，**不對他人資源寫入**）再 update；改成同 owner
   * 既有名撞 `@@unique([ownerId,name])`（P2002）→ 409。geo/language 不可改（DTO 僅收 name，AC-28.5）。
   */
  async rename(
    listId: string,
    dto: RenameTrackingListDto,
    actor: AuthenticatedUser,
  ): Promise<TrackingListView> {
    const existing = await this.prisma.trackingList.findUnique({
      where: { id: listId },
      select: { id: true, ownerId: true },
    });
    assertOwnedRow(existing, actor, notFoundMessage(listId));
    try {
      const row = await this.prisma.trackingList.update({
        where: { id: listId },
        data: { name: dto.name },
      });
      return toView(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw duplicateName(dto.name);
      }
      throw error; // 非 P2002：原樣上拋（不誤判重複）。
    }
  }

  /**
   * 刪除（AC-28.2）：先 `assertOwnedRow`（越權/不存在→404，不刪他人資源）再 delete。成員經 FK
   * `onDelete: Cascade` 一併移除；**時序 `VolumeSnapshot` 無 FK cascade**（僅 `listId` 欄）→ 預設
   * （`TRACKING_KEEP_SERIES_ON_DELETE=false`）由此**顯式** `deleteMany({listId})` 連帶刪除；`true` 則
   * 跳過、保留孤立快照供日後重建 / 稽核（T11.8，AC-28.2）。
   */
  async remove(listId: string, actor: AuthenticatedUser): Promise<{ listId: string }> {
    const existing = await this.prisma.trackingList.findUnique({
      where: { id: listId },
      select: { id: true, ownerId: true },
    });
    assertOwnedRow(existing, actor, notFoundMessage(listId));
    if (!this.config.keepSeriesOnDelete) {
      await this.prisma.volumeSnapshot.deleteMany({ where: { listId } });
    }
    await this.prisma.trackingList.delete({ where: { id: listId } });
    return { listId };
  }
}

/** DB 列 → 對外基本面（id→listId）。 */
function toView(row: ListRow): TrackingListView {
  return {
    listId: row.id,
    name: row.name,
    geo: row.geo,
    language: row.language,
    createdAt: row.createdAt,
  };
}

/** 單列越權/不存在的**同一** 404 訊息（不洩漏存在性，AC-27.3/27.4）。 */
function notFoundMessage(listId: string): string {
  return `Tracking list ${listId} not found`;
}

/**
 * 時序快照查詢 `where`（FR-30，AC-30.3）：固定 `listId` + scope 至**現有成員** `normalizedText`（排除已移除成員
 * 遺留快照的孤 axis 點）；`from`/`to` 存在時加 `fetchedAt` **含端點**過濾（`gte`/`lte`）——皆缺則不設時間界。
 */
function seriesWhere(
  listId: string,
  memberKeys: string[],
  range: SeriesRange,
): Prisma.VolumeSnapshotWhereInput {
  const where: Prisma.VolumeSnapshotWhereInput = {
    listId,
    normalizedText: { in: memberKeys },
  };
  if (range.from || range.to) {
    const fetchedAt: Prisma.DateTimeFilter = {};
    if (range.from) {
      fetchedAt.gte = range.from;
    }
    if (range.to) {
      fetchedAt.lte = range.to;
    }
    where.fetchedAt = fetchedAt;
  }
  return where;
}

/** 成員語境（geo/language）與清單層不符 → 400（AC-28.5，不默默改寫）。 */
function contextMismatchMessage(geo: string, language: string): string {
  return `Member geo/language must match the list context (geo=${geo}, language=${language})`;
}

/** 加入後成員數超過每清單上限 → 409（AC-28.7）。 */
function limitMessage(max: number): string {
  return `Tracking list member limit reached (max ${max})`;
}

/** 該 owner 清單數達上限 → 409（AC-28.7，保護 Ads 配額）。 */
function listLimitMessage(max: number): string {
  return `Tracking list limit reached (max ${max})`;
}

/** 移除時無此成員（`normalizedText`）→ 404（AC-28.6）。 */
function memberNotFoundMessage(normalizedText: string): string {
  return `Member "${normalizedText}" not found in tracking list`;
}

/** 單批 `items` 數超過請求上限 → 400（NFR-16 DoS 前置守門，先於任何 DB 展開）。 */
function tooManyItemsMessage(max: number): string {
  return `Too many items in one request (max ${max})`;
}

/** Prisma 唯一鍵衝突（P2002）判定——`@@unique([ownerId,name])` 撞名（比照 keyword-analysis 慣例）。 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** 同 owner 重名 → 409（單一訊息）。 */
function duplicateName(name: string): ConflictException {
  return new ConflictException(`Tracking list "${name}" already exists`);
}
