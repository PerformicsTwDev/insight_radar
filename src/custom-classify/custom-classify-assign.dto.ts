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
 * → 400；空陣列 → 400（`ArrayMinSize(1)`，無法建動態 enum；service 另留 `ConflictException` defensive 守衛供非
 * HTTP 呼叫）。上限 `ArrayMaxSize(500)`＝**structured-outputs 動態 enum 硬上限**（Design §4.2）；`CUSTOM_CLASSIFY_MAX_LABELS`
 * （預設 12）只約束**階段一產生**標籤數，階段二的確認集（人可增刪）僅受此 500 上限。
 */
export class CustomClassifyAssignDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ConfirmedLabelDto)
  labels!: ConfirmedLabelDto[];
}
