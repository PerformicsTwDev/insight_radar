import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CreateKeywordAnalysisDto } from './dto/create-keyword-analysis.dto';
import { KeywordAnalysisService } from './keyword-analysis.service';
import type { AnalysisParams, AnalysisStatusResponse } from './keyword-analysis.service';

/**
 * KeywordAnalysis HTTP 入口（T3.3，FR-1）。掛 `/api/v1/keyword-analyses`（全域前綴）。
 * 全域 `ApiKeyGuard`（缺/錯 key → 401）與 `ValidationPipe`（空 seeds/缺 geo·language/非法 mode → 400）
 * 已套用。`create` 為 **enqueue-only**：委派 service 入列即回 202，路徑不呼叫任何外部 API（NFR-1）。
 */
@Controller('keyword-analyses')
export class KeywordAnalysisController {
  constructor(private readonly service: KeywordAnalysisService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@Body() dto: CreateKeywordAnalysisDto): Promise<{ analysisId: string }> {
    const params: AnalysisParams = {
      geo: dto.geo,
      language: dto.language,
      mode: dto.mode ?? 'expand',
      includeAdult: dto.includeAdult ?? false,
      network: dto.network ?? 'GOOGLE_SEARCH',
    };
    return this.service.create({ seeds: dto.seeds, params });
  }

  /** 輪詢分析狀態（T3.4，FR-8）。不存在的 id → 404（service 拋 NotFoundException）。 */
  @Get(':id')
  getStatus(@Param('id') id: string): Promise<AnalysisStatusResponse> {
    return this.service.getStatus(id);
  }
}
