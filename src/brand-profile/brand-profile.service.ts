import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { assertOwnedRow, ownerIdOf, ownerWhere } from '../common/owner-scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  type BrandProfileView,
  toAliasWriteList,
  toBrandProfileView,
  toCompetitorWriteList,
} from './brand-profile.mapper';
import type { CreateBrandProfileDto } from './dto/create-brand-profile.dto';
import type { UpdateBrandProfileDto } from './dto/update-brand-profile.dto';

export type { BrandEntry, BrandProfileView } from './brand-profile.mapper';

/**
 * BrandProfileService (T14.5, FR-40)——品牌檔案 CRUD + **owner scope 強制**。
 *
 * owner 過濾唯一單點＝T10.6 helper（`ownerIdOf` 建立歸屬、`ownerWhere` 列表過濾、`assertOwnedRow` 單列越權/
 * 不存在同回 404）；owner **只**由已認證 actor 推導，**永不**由請求參數（`?ownerId=`）覆寫（AC-27.4/S8，強制點
 * 在此 service 層而非 controller）。同 owner `name` 撞 `@@unique([ownerId,name])`（P2002）→ 409。無外部 API、
 * 無業務上限（品牌檔案不觸 Ads 配額）。`brand` 巢狀入參 → 扁平 `name/aliases/sites` 欄 + `competitors` JSON
 * （純映射在 {@link ./brand-profile.mapper}，本 service 僅 DI 編排）。
 */
@Injectable()
export class BrandProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 建立品牌檔案（AC-40.1）：`ownerId` 由 actor 決定（session→id、apiKey→null）。`brand.{name,aliases,sites}` 落
   * 扁平欄、`competitors` 收斂為 `[{name,aliases[],sites[]}]` JSON。同 owner 重名撞 `@@unique`（P2002）→ 409
   * （非 P2002 原樣上拋，不誤判重複）。
   */
  async create(dto: CreateBrandProfileDto, actor: AuthenticatedUser): Promise<BrandProfileView> {
    const ownerId = ownerIdOf(actor);
    try {
      const row = await this.prisma.brandProfile.create({
        data: {
          ownerId,
          name: dto.brand.name,
          aliases: toAliasWriteList(dto.brand.aliases),
          sites: toAliasWriteList(dto.brand.sites),
          competitors: toCompetitorWriteList(dto.competitors),
        },
      });
      return toBrandProfileView(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw duplicateName(dto.brand.name);
      }
      throw error; // 非 P2002：原樣上拋（不誤判為重複）。
    }
  }

  /**
   * 品牌檔案列表（AC-40.1）：以 `ownerWhere(actor)` 過濾（session→自己+共享 null；apiKey→全部，AC-27.5）、
   * `createdAt desc`。owner 僅源自 actor，`?ownerId=` 無法拓寬（AC-27.4）。
   */
  async list(actor: AuthenticatedUser): Promise<BrandProfileView[]> {
    const rows = await this.prisma.brandProfile.findMany({
      where: ownerWhere(actor),
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toBrandProfileView);
  }

  /** 品牌檔案詳情（AC-40.1）：越權/不存在 → **同一 404**（`assertOwnedRow`，不洩漏存在性，AC-27.3/27.4）。 */
  async get(id: string, actor: AuthenticatedUser): Promise<BrandProfileView> {
    const row = await this.prisma.brandProfile.findUnique({ where: { id } });
    assertOwnedRow(row, actor, notFoundMessage(id));
    return toBrandProfileView(row);
  }

  /**
   * 更新（AC-40.1）——欄位級 partial。先 `assertOwnedRow`（越權/不存在→404，**不對他人資源寫入**）再 update；
   * 只寫入有帶的欄位（改名不連帶清 aliases/sites）。改成同 owner 既有名撞 `@@unique`（P2002）→ 409。
   */
  async update(
    id: string,
    dto: UpdateBrandProfileDto,
    actor: AuthenticatedUser,
  ): Promise<BrandProfileView> {
    const existing = await this.prisma.brandProfile.findUnique({
      where: { id },
      select: { id: true, ownerId: true },
    });
    assertOwnedRow(existing, actor, notFoundMessage(id));

    const data: Prisma.BrandProfileUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.aliases !== undefined) {
      data.aliases = toAliasWriteList(dto.aliases);
    }
    if (dto.sites !== undefined) {
      data.sites = toAliasWriteList(dto.sites);
    }
    if (dto.competitors !== undefined) {
      data.competitors = toCompetitorWriteList(dto.competitors);
    }

    try {
      const row = await this.prisma.brandProfile.update({ where: { id }, data });
      return toBrandProfileView(row);
    } catch (error) {
      // P2002 只可能來自 name 撞 `@@unique([ownerId,name])`（此路徑 dto.name 必為新名）→ 409。
      if (isUniqueViolation(error)) {
        throw duplicateName(dto.name);
      }
      throw error; // 非 P2002：原樣上拋（不誤判重複）。
    }
  }

  /** 刪除（AC-40.1）：先 `assertOwnedRow`（越權/不存在→404，不刪他人資源）再 delete。回被刪的 id。 */
  async remove(id: string, actor: AuthenticatedUser): Promise<{ id: string }> {
    const existing = await this.prisma.brandProfile.findUnique({
      where: { id },
      select: { id: true, ownerId: true },
    });
    assertOwnedRow(existing, actor, notFoundMessage(id));
    await this.prisma.brandProfile.delete({ where: { id } });
    return { id };
  }
}

/** 單列越權/不存在的**同一** 404 訊息（不洩漏存在性，AC-27.3/27.4）。 */
function notFoundMessage(id: string): string {
  return `Brand profile ${id} not found`;
}

/** Prisma 唯一鍵衝突（P2002）判定——`@@unique([ownerId,name])` 撞名（比照 tracking-list 慣例）。 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** 同 owner 重名 → 409（單一訊息）。`name` 於 update 撞名時保證 defined；型別放寬僅為滿足編譯（無分支）。 */
function duplicateName(name: string | undefined): ConflictException {
  return new ConflictException(`Brand profile "${name}" already exists`);
}
