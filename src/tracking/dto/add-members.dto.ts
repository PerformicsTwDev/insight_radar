import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * `POST /tracking-lists/:listId/members` 的成員項（FR-28，AC-28.4/28.5；Design §17.3）。**判別聯集**
 * （`kind` 判別）——`MemberItem` 靜態型別給消費端乾淨窄化，`MemberItemDto` 為 class-validator 的**執行期
 * 驗證形狀**（單一扁平 class + 逐 kind `@ValidateIf`，避免 class-transformer discriminator 在全域
 * `whitelist`/`forbidNonWhitelisted` pipe 下對未知 kind 的非決定性行為）。
 *
 * 驗證規則（全域 ValidationPipe：whitelist + forbidNonWhitelisted + transform）：
 * - `kind` 必為 `keyword|topic`（未知 kind → 400，`@IsIn`）。
 * - `kind='keyword'` → `text`/`geo`/`language` 必填非空（缺/空 → 400）；`normalizedText` **不由 client 給**，
 *   伺服器端 `normalizeText(text)` 導出（S4，與去重/快取同一套）。
 * - `kind='topic'` → `analysisId`/`topicName` 必填非空（缺/空 → 400）。
 */

/** 判別聯集靜態型別（service 依 `kind` 窄化；執行期形狀由 {@link MemberItemDto} 驗證保證）。 */
export type MemberItem =
  | { kind: 'keyword'; text: string; geo: string; language: string }
  | { kind: 'topic'; analysisId: string; topicName: string };

/** 執行期驗證 class（扁平 + `@ValidateIf` 逐 kind；轉型自 request body 的每個 items 元素）。 */
export class MemberItemDto {
  @ApiProperty({ enum: ['keyword', 'topic'], description: '成員項判別：關鍵字列 / 主題列' })
  @IsIn(['keyword', 'topic'])
  kind!: 'keyword' | 'topic';

  // —— kind='keyword' —— //
  @ApiPropertyOptional({
    description: '關鍵字原字（kind=keyword 必填）；normalizedText 由伺服器導出',
  })
  @ValidateIf((o: MemberItemDto) => o.kind === 'keyword')
  @IsString()
  @IsNotEmpty()
  text?: string;

  @ApiPropertyOptional({ description: '該關鍵字來源分析的 geo 語境（kind=keyword 必填）' })
  @ValidateIf((o: MemberItemDto) => o.kind === 'keyword')
  @IsString()
  @IsNotEmpty()
  geo?: string;

  @ApiPropertyOptional({ description: '該關鍵字來源分析的 language 語境（kind=keyword 必填）' })
  @ValidateIf((o: MemberItemDto) => o.kind === 'keyword')
  @IsString()
  @IsNotEmpty()
  language?: string;

  // —— kind='topic' —— //
  @ApiPropertyOptional({ description: '主題來源分析 id（kind=topic 必填）' })
  @ValidateIf((o: MemberItemDto) => o.kind === 'topic')
  @IsString()
  @IsNotEmpty()
  analysisId?: string;

  @ApiPropertyOptional({
    description: '主題名稱（kind=topic 必填）；展開為該分析最新 run 該群非-noise 關鍵字',
  })
  @ValidateIf((o: MemberItemDto) => o.kind === 'topic')
  @IsString()
  @IsNotEmpty()
  topicName?: string;
}

/**
 * `POST /tracking-lists/:listId/members` body（AC-28.4）：非空 `items`（`@ArrayNotEmpty` → 空陣列 400）。
 * `items` 靜態型別為 `MemberItem[]`（判別聯集，供 service 窄化）；`@Type(() => MemberItemDto)` 令
 * class-transformer 以 {@link MemberItemDto} 逐元素轉型並巢狀驗證（型別/缺欄位/未知 kind → 400）。
 */
export class AddMembersDto {
  @ApiProperty({
    type: () => MemberItemDto,
    isArray: true,
    description: '成員項（關鍵字列 / 主題列）',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MemberItemDto)
  items!: MemberItem[];
}
