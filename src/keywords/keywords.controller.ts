import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
// 值匯入（非 `import type`）：DTO 為 @Query() 的執行期 metatype，ValidationPipe 需真實 class 才會驗證/轉換。
import { FilterKeywordsQueryDto } from './dto/filter-keywords-query.dto';
import type { FilterSpec } from './filter-spec';
import type { PageSpec, SortSpec } from './paginate';
import { type KeywordsListResponse, SnapshotQueryService } from './snapshot-query.service';

/**
 * 讀取層 HTTP 入口（T6.1，FR-3/4/6/7）。掛 `/api/v1/keyword-analyses/:id/keywords`（全域前綴）。
 * 全域 `ApiKeyGuard`（缺/錯 key → 401）+ `ValidationPipe`（非法 query / `min>max` → 400）已套用；
 * `id` 經 `ParseUUIDPipe`（非 UUID → 400，避免 Prisma UUID 欄位 P2023 → 500）。回 §6.4 `{ data, meta }`
 * 五欄列（`intent` 對外 `intentLabels`，AC-6.1）。
 */
@Controller('keyword-analyses')
export class KeywordsController {
  constructor(private readonly snapshotQuery: SnapshotQueryService) {}

  @Get(':id/keywords')
  getKeywords(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FilterKeywordsQueryDto,
  ): Promise<KeywordsListResponse> {
    return this.snapshotQuery.listKeywords(
      id,
      toFilterSpec(query),
      toSortSpec(query),
      toPageSpec(query),
    );
  }
}

/** query DTO → 共用 `FilterSpec`（buildPredicate 會略過 undefined 欄位）。 */
function toFilterSpec(dto: FilterKeywordsQueryDto): FilterSpec {
  return {
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
}

/** query DTO → 排序（預設 `avgMonthlySearches desc` 由 sortRows 補，AC-6.2）。 */
function toSortSpec(dto: FilterKeywordsQueryDto): SortSpec {
  return { sortBy: dto.sortBy, sortDir: dto.sortDir };
}

function toPageSpec(dto: FilterKeywordsQueryDto): PageSpec {
  return { page: dto.page, pageSize: dto.pageSize, cursor: dto.cursor };
}
