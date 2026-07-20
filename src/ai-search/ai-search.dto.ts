import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { CAPTURE_CHANNELS, type CaptureChannel } from '../captures/dto/capture-ingest.dto';

/**
 * `POST /api/v1/ai-search-analyses` 入參（T14.6，FR-41/AC-41.1；Design §18.3）。全域 ValidationPipe
 * （whitelist + forbidNonWhitelisted + transform）驗證：未宣告欄位 → 400；空 keywords / 空或未知 channel / 非 UUID
 * brandProfileId → 400。`@ApiProperty` 顯式標註（不依賴 swagger CLI plugin，openapi 自省閉環 FR-22）。
 *
 * channels 沿用 capture 渠道 enum（S20）：extension 主管道（chatGpt/geminiApp/googleAiMode/googleSearch）+ SerpAPI
 * reserved（aiOverview/aiMode/bingCopilot）。job 內依渠道路由來源（見 ai-search-channels）；某渠道缺 → partial（INV-6）。
 */
export class CreateAiSearchAnalysisDto {
  @ApiProperty({ type: [String], minItems: 1, example: ['asus zenbook', 'macbook air'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  keywords!: string[];

  @ApiProperty({
    enum: CAPTURE_CHANNELS,
    isArray: true,
    minItems: 1,
    example: ['chatGpt', 'googleAiMode'],
    description: 'AI 渠道（extension primary / serpapi reserved，S20）；某渠道缺→partial',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn([...CAPTURE_CHANNELS], { each: true })
  channels!: CaptureChannel[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: '品牌檔案（FR-40）；供 M15 可見度分析，本抓取層僅記錄關聯',
  })
  @IsOptional()
  @IsUUID()
  brandProfileId?: string;
}
