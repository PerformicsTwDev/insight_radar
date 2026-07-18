import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { CurrentActor } from '../common/current-actor.decorator';
import { AiInsightGenerationFilter } from './ai-insight-generation.filter';
import { AiInsightDto } from './ai-insight.dto';
import { AiInsightService } from './ai-insight.service';
import type { AiInsight } from './ai-insight.types';

/**
 * per-view AI 洞察 HTTP 入口（T12.4，FR-32 / AC-32.1/32.3/32.4；Design §17.4）。掛
 * `POST /api/v1/keyword-analyses/:id/ai-insight`（全域前綴）。**純委派 shell**：全域 `CompositeAuthGuard`
 * （缺/錯 key → 401）與 whitelist `ValidationPipe`（未宣告欄位如舊 `select` → 400）已套用；`:id` 經
 * `ParseUUIDPipe`（非 UUID → 400，避免 Prisma UUID 欄位 P2023 → 500，M11 gate 前例）。
 *
 * 狀態映射皆**沿用既有單點**、controller 不自行實作：unknown-view → 400 / snapshot 未就緒 → 409 / 非 owner·未知
 * id → 404 全由 `AiInsightService.generate`（→ `SnapshotQueryService`：owner 過濾唯一強制點 S8 + view 白名單）
 * 產生；LLM 失敗（`AiInsightGenerationError`）→ **502** 由 {@link AiInsightGenerationFilter} 於 HTTP 邊界映射
 * （不回半截摘要，AC-32.4）。
 */
@ApiTags('ai-insight')
@Controller('keyword-analyses')
@UseFilters(AiInsightGenerationFilter)
export class AiInsightController {
  constructor(private readonly service: AiInsightService) {}

  @Post(':id/ai-insight')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'per-view AI 洞察（同步 200；LLM 失敗 → 502）' })
  @ApiOkResponse({ description: '{ view, insight, generatedAt }' })
  @ApiBadRequestResponse({
    description: '未知 view / 非 UUID id / 未宣告欄位（whitelist forbidNonWhitelisted）',
  })
  @ApiNotFoundResponse({ description: '未知或非 owner 的 analysis（owner 過濾單點 S8）' })
  @ApiResponse({ status: 409, description: 'snapshot 未就緒 / feature 未 ready' })
  @ApiResponse({
    status: 502,
    description: 'AI_INSIGHT_GENERATION_FAILED（LLM 失敗，不回半截摘要）',
  })
  generate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AiInsightDto,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<AiInsight> {
    return this.service.generate(id, { view: dto.view, filters: dto.filters }, actor);
  }
}
