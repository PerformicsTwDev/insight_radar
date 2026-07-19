import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * `POST /api/v1/captures` 的請求形狀（FR-36 / AC-36.1；Design §18.2）。統一 capture ingestion 端點——
 * 前端代 extension 轉發（push primary），把橋接抓到的 AI 回答 / 社群貼文批次推進 raw append-only 層。
 *
 * 驗證規則（全域 ValidationPipe：whitelist + forbidNonWhitelisted + transform）：
 * - `source` 必為 push 來源 enum（S20；未知 → 400）。`merged` 為多來源 merge 的**內部產物**（FR-46），
 *   **不**由 client push，故不在受理 enum。
 * - `channel?`/`platform?`：AI 類帶 `channel`、Social 類帶 `platform`（S20）；給值時須在 enum 內（不猜形狀）。
 * - `schemaVersion` 必帶非空（S15）——extension 契約現況無 versioning，本端點以此欄補上缺口；**allowlist
 *   比對（`CAPTURE_ACCEPTED_SCHEMA_VERSIONS`，AC-36.3）於 T13.3 接**，本 task 僅驗「必帶非空字串」。
 * - `items` 非空陣列、每筆為物件（該來源原始 payload，逐筆落 `captures.payload` JSONB）。**item 內部形狀不在
 *   此驗證**（raw 層保留原始 payload、由 per-source mapper 於 T13.4 收斂）——故 items 元素**不**套巢狀 DTO，
 *   全域 whitelist 不會剝除其內部鍵。批次筆數上限（`INGEST_BATCH_MAX`，AC-36.5）於 service 層先於 DB 守門。
 */

/** 可 push 的來源（AC-36.1 / S20）：extension（primary）、serpapi / threadsApi（reserved）。 */
export const CAPTURE_SOURCES = ['extension', 'serpapi', 'threadsApi'] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

/** AI 渠道（S20）。 */
export const CAPTURE_CHANNELS = [
  'chatGpt',
  'geminiApp',
  'googleAiMode',
  'googleSearch',
  'aiOverview',
  'aiMode',
  'bingCopilot',
] as const;
export type CaptureChannel = (typeof CAPTURE_CHANNELS)[number];

/** Social 平台（S20）。 */
export const CAPTURE_PLATFORMS = ['threads', 'facebook', 'dcard', 'ptt', 'customDomain'] as const;
export type CapturePlatform = (typeof CAPTURE_PLATFORMS)[number];

export class CaptureIngestDto {
  @ApiProperty({
    enum: CAPTURE_SOURCES,
    description: 'push 來源（extension=primary；serpapi/threadsApi=reserved）',
  })
  @IsIn([...CAPTURE_SOURCES])
  source!: CaptureSource;

  @ApiPropertyOptional({ enum: CAPTURE_CHANNELS, description: 'AI 渠道（AI 類帶；S20）' })
  @IsOptional()
  @IsIn([...CAPTURE_CHANNELS])
  channel?: CaptureChannel;

  @ApiPropertyOptional({ enum: CAPTURE_PLATFORMS, description: 'Social 平台（Social 類帶；S20）' })
  @IsOptional()
  @IsIn([...CAPTURE_PLATFORMS])
  platform?: CapturePlatform;

  @ApiProperty({ description: 'schemaVersion 必帶（S15）；allowlist 比對於 T13.3' })
  @IsString()
  @IsNotEmpty()
  schemaVersion!: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: '該來源原始 payload 陣列（raw，逐筆落 captures.payload JSONB）',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsObject({ each: true })
  items!: Record<string, unknown>[];
}
