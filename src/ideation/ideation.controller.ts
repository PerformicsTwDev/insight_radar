import { Body, Controller, HttpCode, HttpStatus, Post, UseFilters } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IdeationDto } from './ideation.dto';
import { IdeationGenerationFilter } from './ideation-generation.filter';
import { IdeationService } from './ideation.service';
import type { IdeationResult } from './ideation.types';

/**
 * AI 輔助發想 HTTP 入口（T12.10，FR-35 / AC-35.1/35.2；Design §17.4）。掛 `POST /api/v1/ai-ideation`（全域前綴，
 * **standalone**——非巢狀於分析、無 owner-scope）。**純委派 shell + 同步 200**：全域 `CompositeAuthGuard`
 * （缺/錯 key → 401）與 whitelist `ValidationPipe`（未知 template `@IsIn`→400 / 空 seeds→400 / 未宣告欄位→400）
 * 已套用。LLM 失敗（`IdeationGenerationError`）→ **502** 由 {@link IdeationGenerationFilter} 於 HTTP 邊界映射
 * （不回半成品）。回傳 `{ keywords }` 形狀相容 `POST /keyword-analyses` 的 `seeds`（**不自動建立分析**，AC-35.4）。
 */
@ApiTags('ideation')
@Controller('ai-ideation')
@UseFilters(IdeationGenerationFilter)
export class IdeationController {
  constructor(private readonly service: IdeationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  generate(@Body() dto: IdeationDto): Promise<IdeationResult> {
    return this.service.generate({ template: dto.template, seeds: dto.seeds });
  }
}
