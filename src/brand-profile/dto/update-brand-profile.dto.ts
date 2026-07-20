import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BrandEntryDto } from './brand-entry.dto';

/**
 * `PATCH /brand-profiles/:id` 入參（T14.5，FR-40 / AC-40.1）——**欄位級 partial 更新**。
 *
 * 刻意採扁平選填欄位（非 POST 的巢狀 `brand`）：只更新有帶的欄位，**改名不連帶清掉 aliases/sites**（避免
 * 「巢狀 brand 全取代」的資料丟失 footgun）。全欄缺省＝no-op 回現況。改成同 owner 既有名撞 `@@unique`（P2002）
 * → 409（service 層）。ownerId 不可改（不在 DTO；owner 僅由 actor 推導，AC-27.4）。
 */
export class UpdateBrandProfileDto {
  @ApiPropertyOptional({ example: 'ASUS', description: '本品牌新名稱（同 owner 內唯一）' })
  @IsOptional()
  @IsString()
  @IsNotEmpty() // 有帶就不得為空字串（唯一鍵欄位）
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ type: [String], description: '本品牌別名（整組取代）' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  aliases?: string[];

  @ApiPropertyOptional({ type: [String], description: '本品牌官網 domain（整組取代）' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  sites?: string[];

  @ApiPropertyOptional({ type: [BrandEntryDto], description: '競品清單（整組取代）' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BrandEntryDto)
  competitors?: BrandEntryDto[];
}
