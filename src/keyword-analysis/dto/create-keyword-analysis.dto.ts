import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

/** Ads network 選項（預設 GOOGLE_SEARCH）。 */
export const ANALYSIS_NETWORKS = ['GOOGLE_SEARCH', 'GOOGLE_SEARCH_AND_PARTNERS'] as const;
/** 取數模式：expand=拓展（GenerateKeywordIdeas）／exact=指定取歷史指標。 */
export const ANALYSIS_MODES = ['expand', 'exact'] as const;

/**
 * `POST /keyword-analyses` 入參（Design §6.1）。全域 ValidationPipe（whitelist +
 * forbidNonWhitelisted + transform）驗證：未宣告欄位 → 400；optional 欄位須宣告於此，
 * 否則 whitelist 會剝除（如 `includeAdult`/`mode`）。空 seeds / 缺 geo/language → 400。
 */
export class CreateKeywordAnalysisDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  seeds!: string[];

  @IsString()
  geo!: string;

  @IsString()
  language!: string;

  @IsOptional()
  @IsIn(ANALYSIS_NETWORKS)
  network?: (typeof ANALYSIS_NETWORKS)[number];

  @IsOptional()
  @IsBoolean()
  includeAdult?: boolean;

  @IsOptional()
  @IsIn(ANALYSIS_MODES)
  mode?: (typeof ANALYSIS_MODES)[number];
}
