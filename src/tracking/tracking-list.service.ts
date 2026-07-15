import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { assertOwnedRow, ownerIdOf, ownerWhere } from '../common/owner-scope';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

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

/** Prisma 唯一鍵衝突（P2002）判定——`@@unique([ownerId,name])` 撞名（比照 keyword-analysis 慣例）。 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** 同 owner 重名 → 409（單一訊息）。 */
function duplicateName(name: string): ConflictException {
  return new ConflictException(`Tracking list "${name}" already exists`);
}
