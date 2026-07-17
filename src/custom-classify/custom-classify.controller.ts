import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { CurrentActor } from '../common/current-actor.decorator';
import { CustomClassifyDto } from './custom-classify.dto';
import { CustomClassifyGenerationFilter } from './custom-classify.filter';
import { CustomClassifyService } from './custom-classify.service';
import type { CustomClassification } from './custom-classify.types';

/**
 * 自訂分類**階段一** HTTP 入口（T12.7，FR-34 / AC-34.1；Design §17.5）。掛
 * `POST /api/v1/keyword-analyses/:id/custom-classifications`（全域前綴）。**純委派 shell**：全域
 * `CompositeAuthGuard`（缺/錯 key → 401）與 whitelist `ValidationPipe`（未宣告欄位 → 400）已套用；`:id` 經
 * `ParseUUIDPipe`（非 UUID → 400，避免 Prisma UUID 欄位 P2023 → 500）。
 *
 * 狀態映射皆**沿用既有單點**、controller 不自行實作：非 owner·未知 id → 404 / snapshot 未就緒 → 409 全由
 * `CustomClassifyService.generateLabels`（→ `SnapshotQueryService.resolveReadySnapshotId`：owner 過濾唯一強制點
 * S8）產生；LLM 失敗（`CustomClassifyGenerationError`）→ **502** 由 {@link CustomClassifyGenerationFilter} 於
 * HTTP 邊界映射（不回半成品，AC-34.1）。
 */
@ApiTags('custom-classify')
@Controller('keyword-analyses')
@UseFilters(CustomClassifyGenerationFilter)
export class CustomClassifyController {
  constructor(private readonly service: CustomClassifyService) {}

  @Post(':id/custom-classifications')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CustomClassifyDto,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<CustomClassification> {
    return this.service.generateLabels(id, { name: dto.name, instruction: dto.instruction }, actor);
  }

  /**
   * 刪除自訂分類定義 + 級聯（T12.9，FR-34/AC-34.5）。`:id`/`:cid` 經 `ParseUUIDPipe`（非 UUID→400）；owner/存在性
   * 404 由 `CustomClassifyService.remove`（`assertOwnedRow` 單點 S8）產生；動態 `custom:{cid}` view 免註銷（刪列後自然 404）。
   */
  @Delete(':id/custom-classifications/:cid')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cid', ParseUUIDPipe) cid: string,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<{ classificationId: string }> {
    return this.service.remove(id, cid, actor);
  }
}
