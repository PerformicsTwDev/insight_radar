import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateBrandProfileDto } from './dto/create-brand-profile.dto';
import type { UpdateBrandProfileDto } from './dto/update-brand-profile.dto';

/** 品牌 / 競品的對外形狀（name + aliases[] + sites[]）——與 AC-40.1 入參 `brand` 子物件對稱。 */
export interface BrandEntry {
  name: string;
  aliases: string[];
  sites: string[];
}

/** 品牌檔案對外形狀（create/get/list/update 回傳）：`brand` 巢狀 + `competitors[]`；**不外洩 ownerId**。 */
export interface BrandProfileView {
  id: string;
  brand: BrandEntry;
  competitors: BrandEntry[];
  createdAt: Date;
}

/**
 * BrandProfileService（T14.5，FR-40）——品牌檔案 CRUD + **owner scope 強制**。
 *
 * ⚠ shell（T14.5 red）：typed not-implemented 空殼，讓 e2e/int 測試「斷言紅」（服務丟錯→500/reject）而非
 * 「編譯紅」。owner 過濾唯一單點（T10.6 helper）與 409 dup-name 於 green 實作。
 */
@Injectable()
export class BrandProfileService {
  constructor(private readonly prisma: PrismaService) {}

  create(_dto: CreateBrandProfileDto, _actor: AuthenticatedUser): Promise<BrandProfileView> {
    // green（T14.5）：this.prisma.brandProfile.create(...) + owner-scope helper。shell 先引用 prisma 讓型別完整。
    return this.prisma.brandProfile.findMany().then((): BrandProfileView => {
      throw new Error('not implemented: BrandProfileService.create (T14.5)');
    });
  }

  list(_actor: AuthenticatedUser): Promise<BrandProfileView[]> {
    throw new Error('not implemented: BrandProfileService.list (T14.5)');
  }

  get(_id: string, _actor: AuthenticatedUser): Promise<BrandProfileView> {
    throw new Error('not implemented: BrandProfileService.get (T14.5)');
  }

  update(
    _id: string,
    _dto: UpdateBrandProfileDto,
    _actor: AuthenticatedUser,
  ): Promise<BrandProfileView> {
    throw new Error('not implemented: BrandProfileService.update (T14.5)');
  }

  remove(_id: string, _actor: AuthenticatedUser): Promise<{ id: string }> {
    throw new Error('not implemented: BrandProfileService.remove (T14.5)');
  }
}
