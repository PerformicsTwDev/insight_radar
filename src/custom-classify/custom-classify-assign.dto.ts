import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * 確認後的單一標籤（T12.8，FR-34 / AC-34.2）。沿用階段一形狀 `{ label, description }`（人可增刪後回送）。
 * `description` 供 LLM 分類指引。
 */
export class ConfirmedLabelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label!: string;

  @IsString()
  @MaxLength(500)
  description!: string;
}

/**
 * `POST /keyword-analyses/:id/custom-classifications/:cid/assignments` body（T12.8，FR-34 / AC-34.2）。契約 =
 * `{ labels: [{ label, description }] }`＝HITL 確認後的最終標籤集合。全域 whitelist ValidationPipe 擋未宣告欄位
 * → 400；空陣列 → 400（`ArrayMinSize(1)`，無法建動態 enum，另於 service 以 409 對「確認集為空」把關）。上限
 * `ArrayMaxSize` 防 enum 無界膨脹（structured-outputs enum ≤500；業務上限另由 service 對 `CUSTOM_CLASSIFY_MAX_LABELS`）。
 */
export class CustomClassifyAssignDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ConfirmedLabelDto)
  labels!: ConfirmedLabelDto[];
}
