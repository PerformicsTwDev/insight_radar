import { IsArray, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { IsNotGreaterThan } from '../../common/validators/is-not-greater-than.validator';
import type { FilterSpec } from '../filter-spec';
import { INTENT_MODES, type IntentMode } from './filter-keywords-query.dto';

/**
 * `POST /query` body 的 `filters` 巢狀 DTO（T6.6，共用 `FilterSpec`）。JSON body 值本已具型別，故**不需**
 * `@Transform`（對比 `GET /keywords` 的 query-string DTO 須把空字串轉 undefined）；此處只做**型別 + `min<=max`**
 * 驗證，錯型別（`intent` 非陣列、`q` 非字串、`volumeMin` 非數值…）與未宣告鍵 → 400，不讓錯型別流進 buildPredicate
 * 而拋 TypeError → 500（AC-14.3）。欄位鍵是否屬該 view 的 allowedFilters 仍由 `QueryViewService` 依 view 白名單把關。
 */
export class FilterSpecDto implements FilterSpec {
  @IsOptional()
  @IsNumber()
  @IsNotGreaterThan('volumeMax')
  volumeMin?: number;

  @IsOptional()
  @IsNumber()
  volumeMax?: number;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  intent?: string[];

  @IsOptional()
  @IsIn(INTENT_MODES)
  intentMode?: IntentMode;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  competition?: string[];

  @IsOptional()
  @IsNumber()
  @IsNotGreaterThan('competitionIndexMax')
  competitionIndexMin?: number;

  @IsOptional()
  @IsNumber()
  competitionIndexMax?: number;

  @IsOptional()
  @IsNumber()
  @IsNotGreaterThan('cpcMax')
  cpcMin?: number;

  @IsOptional()
  @IsNumber()
  cpcMax?: number;
}
