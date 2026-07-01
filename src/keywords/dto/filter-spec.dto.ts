import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { IsNotGreaterThan } from '../../common/validators/is-not-greater-than.validator';
import type { FilterSpec } from '../filter-spec';
import { INTENT_MODES, type IntentMode } from './filter-keywords-query.dto';

/**
 * 顯式 JSON `null` → `undefined`（**視為未設**，不施加約束）。前端清空篩選常送 `null`——`@IsOptional` 會把 `null`
 * 當缺省而**跳過** `@IsNumber`/`@IsString`，使 `null` 直達 `buildPredicate`：`q:null` → `null.toLowerCase()` 500、
 * range `:null` 以 null 界啟動 predicate 而靜默丟缺值列（違 缺值≠0，M6-R1）。此 transform 在驗證前把 `null` 正規化為
 * `undefined`，與 GET query-string DTO 的空值處理一致（M5-R1）。
 */
const nullToUndefined = ({ value }: { value: unknown }): unknown =>
  value === null ? undefined : value;

/**
 * `POST /query` body 的 `filters` 巢狀 DTO（T6.6，共用 `FilterSpec`）。JSON body 值本已具型別，故**不需**
 * 型別 `@Transform`（對比 `GET /keywords` 的 query-string DTO 須把空字串轉 undefined）；此處只做 `null`→未設正規化
 * ＋**型別 + `min<=max`** 驗證，錯型別（`intent` 非陣列、`q` 非字串、`volumeMin` 非數值…）與未宣告鍵 → 400，不讓
 * 錯型別/`null` 流進 buildPredicate（AC-14.3 / M6-R1）。欄位鍵是否屬該 view 的 allowedFilters 仍由 `QueryViewService`
 * 依 view 白名單把關。
 */
export class FilterSpecDto implements FilterSpec {
  @IsOptional()
  @Transform(nullToUndefined)
  @IsNumber()
  @IsNotGreaterThan('volumeMax')
  volumeMin?: number;

  @IsOptional()
  @Transform(nullToUndefined)
  @IsNumber()
  volumeMax?: number;

  @IsOptional()
  @Transform(nullToUndefined)
  @IsString()
  q?: string;

  @IsOptional()
  @Transform(nullToUndefined)
  @IsArray()
  @IsString({ each: true })
  intent?: string[];

  @IsOptional()
  @Transform(nullToUndefined)
  @IsIn(INTENT_MODES)
  intentMode?: IntentMode;

  @IsOptional()
  @Transform(nullToUndefined)
  @IsArray()
  @IsString({ each: true })
  competition?: string[];

  @IsOptional()
  @Transform(nullToUndefined)
  @IsNumber()
  @IsNotGreaterThan('competitionIndexMax')
  competitionIndexMin?: number;

  @IsOptional()
  @Transform(nullToUndefined)
  @IsNumber()
  competitionIndexMax?: number;

  @IsOptional()
  @Transform(nullToUndefined)
  @IsNumber()
  @IsNotGreaterThan('cpcMax')
  cpcMin?: number;

  @IsOptional()
  @Transform(nullToUndefined)
  @IsNumber()
  cpcMax?: number;
}
