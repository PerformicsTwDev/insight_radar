import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { assertOwnedRow, ownerIdOf, ownerWhere } from '../common/owner-scope';
import { trackingConfig } from '../config/tracking.config';
import { normalizeText } from '../google-ads/normalize';
import { PrismaService } from '../prisma/prisma.service';
import { TopicRepository } from '../topics/topic.repository';
import type { ExpandedTopicMember } from '../topics/topic.repository';
import type { AddMembersDto, MemberItem } from './dto/add-members.dto';
import type { CreateTrackingListDto } from './dto/create-tracking-list.dto';
import type { RenameTrackingListDto } from './dto/rename-tracking-list.dto';

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
   * 建立清單（AC-28.1）：`ownerId` 由 actor 決定（session→id、apiKey→null）；geo/language 固定於清單層
   * （AC-28.5）。同 owner 重名撞 `@@unique([ownerId,name])`（P2002）→ 409（非 P2002 錯誤原樣上拋，不誤判重複）。
   */
  async create(dto: CreateTrackingListDto, actor: AuthenticatedUser): Promise<TrackingListView> {
    const ownerId = ownerIdOf(actor);
    try {
      const row = await this.prisma.trackingList.create({
        data: { ownerId, name: dto.name, geo: dto.geo, language: dto.language },
      });
      return toView(row);
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
   * 加成員（AC-28.4/28.5/28.7）——T11.3。流程：
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
    const list = await this.prisma.trackingList.findUnique({
      where: { id: listId },
      select: { id: true, ownerId: true, geo: true, language: true },
    });
    assertOwnedRow(list, actor, notFoundMessage(listId));

    const candidates = await this.expandItems(dto.items);

    // 語境守門（AC-28.5）：任一展開後關鍵字來源 geo/language 與清單層不符 → 400（不默默改寫）。
    for (const candidate of candidates) {
      if (candidate.geo !== list.geo || candidate.language !== list.language) {
        throw new BadRequestException(contextMismatchMessage(list.geo, list.language));
      }
    }

    // 聯集去重（AC-28.4）：以 normalizedText 對「現有成員 ∪ 本批」去重（已存在 / 批內重複 → 不重複建立）。
    const existing = new Set(
      (
        await this.prisma.trackingListMember.findMany({
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
    const { count: added } = await this.prisma.trackingListMember.createMany({
      data: toAdd,
      skipDuplicates: true,
    });
    const memberCount = await this.prisma.trackingListMember.count({ where: { listId } });
    return { memberCount, added };
  }

  /**
   * 把 `items` 展開攤平為候選成員（帶來源 geo/language 語境，供語境守門）：關鍵字列 `normalizedText` 由
   * 伺服器 `normalizeText(text)` 導出（S4，不由 client 給）；主題列經 `TopicRepository.expandTopicToMembers`
   * 展開為該群非-noise 關鍵字（無此群 / 無 run → 空集合，AC-28.4）。
   */
  private async expandItems(items: MemberItem[]): Promise<ExpandedTopicMember[]> {
    const candidates: ExpandedTopicMember[] = [];
    for (const item of items) {
      if (item.kind === 'keyword') {
        candidates.push({
          normalizedText: normalizeText(item.text),
          text: item.text,
          geo: item.geo,
          language: item.language,
        });
      } else {
        candidates.push(
          ...(await this.topics.expandTopicToMembers(item.analysisId, item.topicName)),
        );
      }
    }
    return candidates;
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
   * 刪除（AC-28.2）：先 `assertOwnedRow`（越權/不存在→404，不刪他人資源）再 delete；成員經 FK
   * `onDelete: Cascade` 一併移除。
   * TODO(T11.4)：`TRACKING_KEEP_SERIES_ON_DELETE` 旗標（保留時序快照）——本任務僅預設 cascade，旗標不在此實作。
   */
  async remove(listId: string, actor: AuthenticatedUser): Promise<{ listId: string }> {
    const existing = await this.prisma.trackingList.findUnique({
      where: { id: listId },
      select: { id: true, ownerId: true },
    });
    assertOwnedRow(existing, actor, notFoundMessage(listId));
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

/** 成員語境（geo/language）與清單層不符 → 400（AC-28.5，不默默改寫）。 */
function contextMismatchMessage(geo: string, language: string): string {
  return `Member geo/language must match the list context (geo=${geo}, language=${language})`;
}

/** 加入後成員數超過每清單上限 → 409（AC-28.7）。 */
function limitMessage(max: number): string {
  return `Tracking list member limit reached (max ${max})`;
}

/** Prisma 唯一鍵衝突（P2002）判定——`@@unique([ownerId,name])` 撞名（比照 keyword-analysis 慣例）。 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** 同 owner 重名 → 409（單一訊息）。 */
function duplicateName(name: string): ConflictException {
  return new ConflictException(`Tracking list "${name}" already exists`);
}
