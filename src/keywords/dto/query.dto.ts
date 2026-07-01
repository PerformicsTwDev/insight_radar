import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import type { FilterSpec } from '../filter-spec';

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

  /** 共用 `FilterSpec`；欄位鍵/`min>max` 由 QueryViewService 依 view 白名單驗證。 */
  @IsOptional()
  @IsObject()
  filters?: FilterSpec;

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
