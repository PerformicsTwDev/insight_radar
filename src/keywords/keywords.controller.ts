import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
// 值匯入（非 `import type`）：DTO 為 @Query()/@Body() 的執行期 metatype，ValidationPipe 需真實 class 才會驗證/轉換。
import { FilterKeywordsQueryDto } from './dto/filter-keywords-query.dto';
import { QueryDto } from './dto/query.dto';
import type { FilterSpec } from './filter-spec';
import type { PageSpec, SortSpec } from './paginate';
import { type KeywordsListResponse, SnapshotQueryService } from './snapshot-query.service';
import type { ViewResult } from './views';

/**
 * 讀取層 HTTP 入口（T6.1，FR-3/4/6/7）。掛 `/api/v1/keyword-analyses/:id/keywords`（全域前綴）。
 * 全域 `CompositeAuthGuard`（缺/錯 key → 401）+ `ValidationPipe`（非法 query / `min>max` → 400）已套用；
 * `id` 經 `ParseUUIDPipe`（非 UUID → 400，避免 Prisma UUID 欄位 P2023 → 500）。回 §6.4 `{ data, meta }`
 * 五欄列（`intent` 對外 `intentLabels`，AC-6.1）。
 */
@ApiTags('keywords')
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

  /**
   * 具名視圖 view-router（T6.6，FR-14，Design §6.5）。前端只給 `view` + select/filters/sort/pagination；
   * `QueryViewService` 依 view 白名單/上限驗證（違反 → 400），回 table `{view,columns,rows,pagination}` 或
   * chart `{view,groups,meta}` / trend `{view,axis,total,series}`。新增 dashboard 表 = 多註冊一個 ViewDefinition。
   */
  @Post(':id/query')
  @HttpCode(HttpStatus.OK)
  postQuery(@Param('id', ParseUUIDPipe) id: string, @Body() dto: QueryDto): Promise<ViewResult> {
    return this.snapshotQuery.query(id, {
      view: dto.view,
      select: dto.select,
      filters: dto.filters,
      sort: dto.sort,
      pagination: dto.pagination,
    });
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
