import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
// 值匯入（非 `import type`）：DTO 為 @Query() 的執行期 metatype，ValidationPipe 需真實 class 才會驗證/轉換。
import { FilterKeywordsQueryDto } from './dto/filter-keywords-query.dto';
import type { FilterSpec } from './filter-spec';
import { SnapshotQueryService } from './snapshot-query.service';
import type { QueryRequest, ViewResult } from './views';

/**
 * 讀取層 HTTP 入口（T6.1，FR-3/4/6/7）。掛 `/api/v1/keyword-analyses/:id/keywords`（全域前綴）。
 * 全域 `ApiKeyGuard`（缺/錯 key → 401）+ `ValidationPipe`（非法 query / `min>max` → 400）已套用；
 * `id` 經 `ParseUUIDPipe`（非 UUID → 400，避免 Prisma UUID 欄位 P2023 → 500）。委派 `SnapshotQueryService`
 * 載入不可變 snapshot → keywords view（`applyFilter`→`selectPage`）。
 */
@Controller('keyword-analyses')
export class KeywordsController {
  constructor(private readonly snapshotQuery: SnapshotQueryService) {}

  @Get(':id/keywords')
  getKeywords(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FilterKeywordsQueryDto,
  ): Promise<ViewResult> {
    return this.snapshotQuery.query(id, toKeywordsRequest(query));
  }
}

/** query DTO → keywords view 的 `QueryRequest`（共用 `FilterSpec` + 單鍵 sort + 分頁）。 */
function toKeywordsRequest(dto: FilterKeywordsQueryDto): QueryRequest {
  const filters: FilterSpec = {
    volumeMin: dto.volumeMin,
    volumeMax: dto.volumeMax,
    q: dto.q,
    intent: dto.intent,
    intentMode: dto.intentMode,
    competition: dto.competition,
    competitionIndexMin: dto.competitionIndexMin,
    competitionIndexMax: dto.competitionIndexMax,
    cpcMin: dto.cpcMin,
    cpcMax: dto.cpcMax,
  };
  return {
    view: 'keywords',
    filters,
    sort: dto.sortBy ? [{ field: dto.sortBy, direction: dto.sortDir ?? 'desc' }] : undefined,
    pagination: { page: dto.page, pageSize: dto.pageSize, cursor: dto.cursor },
  };
}
