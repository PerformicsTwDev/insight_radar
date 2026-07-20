import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * 品牌 / 競品的共同形狀（T14.5，FR-40 / AC-40.1）：`name` + `aliases[]` + `sites[]`。本品牌與每個競品共用此形狀。
 *
 * `name` 必填非空（唯一鍵語意，空字串亦視為缺）；`aliases`/`sites` 選填、預設 `[]`（DTO 不塞預設，由 service 收斂）。
 * `aliases`＝別名/縮寫/拼寫變體（`華碩→ASUS`，正規化聯集比對用，FR-40 / FR-42）；`sites`＝官網 domain（citations
 * 命中用，FR-43）。全域 ValidationPipe（whitelist + forbidNonWhitelisted + transform）擋未宣告欄位 → 400。
 * `@ApiProperty` 顯式標註（不依賴 swagger CLI plugin，使 ts-node 產出與測試一致，FR-22）。
 */
export class BrandEntryDto {
  @ApiProperty({ example: 'ASUS', description: '品牌名稱（本品牌同 owner 內唯一）' })
  @IsString()
  @IsNotEmpty() // 唯一鍵欄位：空字串亦視為缺 name → 400（AC-40.1）
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['華碩', 'Asus'],
    description: '別名/縮寫/拼寫變體（正規化聯集比對用，FR-40）；缺省 []',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  aliases?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['asus.com'],
    description: '官網 domain（citations 命中用，FR-43）；缺省 []',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  sites?: string[];
}
