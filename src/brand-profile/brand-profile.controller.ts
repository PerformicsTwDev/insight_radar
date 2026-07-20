import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { CurrentActor } from '../common/current-actor.decorator';
import { BrandProfileService } from './brand-profile.service';
import type { BrandProfileView } from './brand-profile.service';
import { CreateBrandProfileDto } from './dto/create-brand-profile.dto';
import { UpdateBrandProfileDto } from './dto/update-brand-profile.dto';

/**
 * BrandProfile HTTP 入口（T14.5，FR-40）。掛 `/api/v1/brand-profiles`（全域前綴）。全域 `CompositeAuthGuard`
 * （缺/錯認證→401）、`CsrfGuard`（session 狀態變更需同源 Origin）、`ValidationPipe`（缺 brand.name→400）均已套用。
 * **owner scope 強制在 service 層**（非 controller，AC-27.4/S8）：建立歸屬 actor、列表以 `ownerWhere` 過濾、
 * 單列越權/不存在 → 同一 404（不洩漏存在性）。
 */
@ApiTags('brand-profiles')
@Controller('brand-profiles')
export class BrandProfileController {
  constructor(private readonly service: BrandProfileService) {}

  /** 建立品牌檔案（AC-40.1）：ownerId=actor；缺 brand.name→400；同 owner 重名→409。回建立的檔案（201）。 */
  @Post()
  create(
    @Body() dto: CreateBrandProfileDto,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<BrandProfileView> {
    return this.service.create(dto, actor);
  }

  /** 品牌檔案列表（AC-40.1）：以 `ownerWhere(actor)` 過濾（session→自己+共享 null；apiKey→全部）。 */
  @Get()
  list(@CurrentActor() actor: AuthenticatedUser): Promise<BrandProfileView[]> {
    return this.service.list(actor);
  }

  /** 品牌檔案詳情（AC-40.1）：越權/不存在 → 同一 404（不洩漏存在性）。 */
  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<BrandProfileView> {
    return this.service.get(id, actor);
  }

  /** 更新（AC-40.1）：欄位級 partial；越權/不存在→404；改成同 owner 既有名→409。 */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandProfileDto,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<BrandProfileView> {
    return this.service.update(id, dto, actor);
  }

  /** 刪除（AC-40.1）：越權/不存在→404。回被刪的 id（200）。 */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<{ id: string }> {
    return this.service.remove(id, actor);
  }
}
