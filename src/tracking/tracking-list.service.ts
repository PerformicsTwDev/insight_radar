import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/authenticated-user';
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

/**
 * TrackingListService（T11.2，FR-28）——追蹤清單 CRUD + **owner scope 強制**。
 * owner 過濾唯一單點＝T10.6 helper（`ownerIdOf`/`ownerWhere`/`assertOwnedRow`），永不由請求參數推導（AC-27.4）。
 */
@Injectable()
export class TrackingListService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateTrackingListDto, actor: AuthenticatedUser): Promise<TrackingListView> {
    // RED shell（T11.2）：真實 DB 接線（this.prisma）於 GREEN 落地；此處讀 prisma 僅為型別完備。
    const db = this.prisma ? 'db' : 'nodb';
    throw new Error(
      `T11.2 TrackingListService.create not implemented (${db}): ${dto.name}/${actor.kind}`,
    );
  }

  list(actor: AuthenticatedUser): Promise<TrackingListSummary[]> {
    throw new Error(`T11.2 TrackingListService.list not implemented: ${actor.kind}`);
  }

  getDetail(listId: string, actor: AuthenticatedUser): Promise<TrackingListDetail> {
    throw new Error(`T11.2 TrackingListService.getDetail not implemented: ${listId}/${actor.kind}`);
  }

  rename(
    listId: string,
    dto: RenameTrackingListDto,
    actor: AuthenticatedUser,
  ): Promise<TrackingListView> {
    throw new Error(
      `T11.2 TrackingListService.rename not implemented: ${listId}/${dto.name}/${actor.kind}`,
    );
  }

  remove(listId: string, actor: AuthenticatedUser): Promise<{ listId: string }> {
    throw new Error(`T11.2 TrackingListService.remove not implemented: ${listId}/${actor.kind}`);
  }
}
