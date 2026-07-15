import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * `POST /tracking-lists` 入參（FR-28，AC-28.1）。全域 ValidationPipe（whitelist +
 * forbidNonWhitelisted + transform）驗證：缺 `name`/`geo`/`language` 或未宣告欄位 → 400。
 * `geo`/`language` **固定於清單層**（語境一致，AC-28.5）——成員之後不得偏離（T11.3）。
 * `@ApiProperty` 顯式標註（不依賴 swagger CLI plugin，使 ts-node 產出與測試一致，FR-22）。
 */
export class CreateTrackingListDto {
  @ApiProperty({ example: 'Running shoes', description: '追蹤清單名稱（同 owner 內唯一）' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'TW', description: 'Google Ads geo target（清單層固定）' })
  @IsString()
  geo!: string;

  @ApiProperty({ example: 'zh-TW', description: '語言（清單層固定）' })
  @IsString()
  language!: string;
}
