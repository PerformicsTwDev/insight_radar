import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsObject,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { BrandEntryDto } from './brand-entry.dto';

/**
 * `POST /brand-profiles` 入參（T14.5，FR-40 / AC-40.1）：`{ brand:{name,aliases[],sites[]}, competitors:[…] }`。
 *
 * `brand`＝本品牌（必填、`name` 非空）；`competitors`＝競品清單（選填，各為同一 {name,aliases[],sites[]} 形狀）。
 * ownerId 由 actor 決定（session→id、apiKey→null），**不在 body**——`?ownerId=`/body ownerId 無法覆寫（AC-27.4，
 * forbidNonWhitelisted → 400）。同 owner `brand.name` 重複撞 `@@unique([ownerId,name])`（P2002）→ 409（service 層）。
 */
export class CreateBrandProfileDto {
  @ApiProperty({ type: BrandEntryDto, description: '本品牌（name + aliases + sites）' })
  @IsDefined() // 缺 brand → 400（@ValidateNested 對 undefined 不觸發，須顯式要求存在）
  @IsObject()
  @ValidateNested()
  @Type(() => BrandEntryDto)
  brand!: BrandEntryDto;

  @ApiPropertyOptional({
    type: [BrandEntryDto],
    description: '競品清單（各 name + aliases + sites）；缺省 []',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BrandEntryDto)
  competitors?: BrandEntryDto[];
}
