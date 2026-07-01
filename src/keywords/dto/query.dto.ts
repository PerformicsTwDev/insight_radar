import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { FilterSpecDto } from './filter-spec.dto';

/** 排序鍵（`POST /query` body）。 */
class QuerySortDto {
  @IsString()
  field!: string;

  @IsIn(['asc', 'desc'])
  direction!: 'asc' | 'desc';
}

/** 分頁（`POST /query` body）。 */
class QueryPaginationDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

/**
 * `POST /keyword-analyses/:id/query` body（T6.6，FR-14/NFR-10，Design §6.5）。**形狀驗證**（型別/巢狀/未宣告
 * 欄位 → 400）；**白名單 + 語意**（未知 view / 非 allowedSelect·Filters·Sort / `pageSize`>上限 / `min>max` /
 * 引擎 bounds → 400）由 `QueryViewService` 於路由時把關。`filters` 共用 `FilterSpec`（與 `GET /keywords` 同）。
 */
export class QueryDto {
  @IsString()
  view!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  select?: string[];

  /** 共用 `FilterSpec`（巢狀型別驗證，錯型別/未宣告鍵 → 400）；欄位是否屬 view 的 allowedFilters 由 QueryViewService 把關。 */
  @IsOptional()
  @ValidateNested()
  @Type(() => FilterSpecDto)
  filters?: FilterSpecDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuerySortDto)
  sort?: QuerySortDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => QueryPaginationDto)
  pagination?: QueryPaginationDto;
}
