import { Module } from '@nestjs/common';
import { BrandProfileController } from './brand-profile.controller';
import { BrandProfileService } from './brand-profile.service';

/**
 * BrandProfile 模組（T14.5，FR-40）——品牌檔案 CRUD（綁 ownerId）。`PrismaService` 為全域模組（@Global），
 * 無需在此 import。無外部 API、無佇列、無 config（無業務上限；同 owner 重名由 DB `@@unique([ownerId,name])`
 * + P2002→409 把關）。aliases 聯集正規化比對純函式（{@link ./brand-match}）供 FR-42 品牌抽取（M15）共用。
 */
@Module({
  controllers: [BrandProfileController],
  providers: [BrandProfileService],
  exports: [BrandProfileService],
})
export class BrandProfileModule {}
