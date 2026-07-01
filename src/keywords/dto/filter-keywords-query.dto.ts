import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsNotGreaterThan } from '../../common/validators/is-not-greater-than.validator';
import { SORT_DIRS, SORT_FIELDS, type SortDir, type SortField } from '../paginate';

/** query string 的單值 → 陣列（`?intent=a` → `['a']`；已是陣列則原樣；缺值 → 保持 undefined）。 */
function toArray(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value : [value];
}

/** intent 篩選模式：`any`＝命中任一選定類別（預設）；`all`＝須含全部選定類別。 */
export const INTENT_MODES = ['any', 'all'] as const;
export type IntentMode = (typeof INTENT_MODES)[number];

/**
 * `GET /keyword-analyses/:id/keywords` 查詢參數（T5.4，FR-7）。共用 `FilterSpec`（volume/q/intent/competition/
 * cpc）+ 列表專屬 sort/pagination。全域 ValidationPipe（whitelist + forbidNonWhitelisted + transform）：
 * 未宣告欄位 / 非法值 / `min>max` → **400 + 欄位錯誤**（Design §9.1）。`FilterSpec` 為此 DTO 與
 * aggregate body（T5.5）的共同子集。
 */
export class FilterKeywordsQueryDto {
  // ── 搜量 range ──
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsNotGreaterThan('volumeMax')
  volumeMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  volumeMax?: number;

  // ── 文字 contains ──
  @IsOptional()
  @IsString()
  q?: string;

  // ── 意圖 multi-select ──
  @IsOptional()
  @Transform(({ value }) => toArray(value))
  @IsArray()
  @IsString({ each: true })
  intent?: string[];

  @IsOptional()
  @IsIn(INTENT_MODES)
  intentMode?: IntentMode = 'any';

  // ── 競爭度 ──
  @IsOptional()
  @Transform(({ value }) => toArray(value))
  @IsArray()
  @IsString({ each: true })
  competition?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsNotGreaterThan('competitionIndexMax')
  competitionIndexMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  competitionIndexMax?: number;

  // ── CPC range（區間重疊語意在 buildPredicate；此處僅驗證 min<=max）──
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsNotGreaterThan('cpcMax')
  cpcMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  cpcMax?: number;

  // ── 列表專屬：排序 + 分頁 ──
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: SortField;

  @IsOptional()
  @IsIn(SORT_DIRS)
  sortDir?: SortDir;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}
