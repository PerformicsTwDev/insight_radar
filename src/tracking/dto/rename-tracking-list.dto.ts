import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * `PATCH /tracking-lists/:listId` 入參（FR-28，AC-28.2）：改名。缺 `name`/未宣告欄位 → 400。
 * `geo`/`language` 固定於清單層、不可改（AC-28.5），故此 DTO 僅收 `name`。
 */
export class RenameTrackingListDto {
  @ApiProperty({ example: 'Trail shoes', description: '新清單名稱（同 owner 內唯一）' })
  @IsString()
  @IsNotEmpty() // 唯一鍵欄位：空字串 → 400（AC-28.1）
  name!: string;
}
