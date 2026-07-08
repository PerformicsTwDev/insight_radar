import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

/** Ads network 選項（預設 GOOGLE_SEARCH）。 */
export const ANALYSIS_NETWORKS = ['GOOGLE_SEARCH', 'GOOGLE_SEARCH_AND_PARTNERS'] as const;
/** 取數模式：expand=拓展（GenerateKeywordIdeas）／exact=指定取歷史指標。 */
export const ANALYSIS_MODES = ['expand', 'exact'] as const;

/**
 * `POST /keyword-analyses` 入參（Design §6.1）。全域 ValidationPipe（whitelist +
 * forbidNonWhitelisted + transform）驗證：未宣告欄位 → 400；optional 欄位須宣告於此，
 * 否則 whitelist 會剝除（如 `includeAdult`/`mode`）。空 seeds / 缺 geo/language → 400。
 * `@ApiProperty` 顯式標註（不依賴 swagger CLI plugin，使 ts-node 產出與測試一致，FR-22）。
 */
export class CreateKeywordAnalysisDto {
  @ApiProperty({ type: [String], minItems: 1, example: ['running shoes', 'trail shoes'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  seeds!: string[];

  @ApiProperty({ example: 'TW', description: 'Google Ads geo target（國別）' })
  @IsString()
  geo!: string;

  @ApiProperty({ example: 'zh-TW', description: '語言' })
  @IsString()
  language!: string;

  @ApiProperty({ required: false, enum: ANALYSIS_NETWORKS, example: 'GOOGLE_SEARCH' })
  @IsOptional()
  @IsIn(ANALYSIS_NETWORKS)
  network?: (typeof ANALYSIS_NETWORKS)[number];

  @ApiProperty({ required: false, example: false })
  @IsOptional()
  @IsBoolean()
  includeAdult?: boolean;

  @ApiProperty({ required: false, enum: ANALYSIS_MODES, example: 'expand' })
  @IsOptional()
  @IsIn(ANALYSIS_MODES)
  mode?: (typeof ANALYSIS_MODES)[number];
}
