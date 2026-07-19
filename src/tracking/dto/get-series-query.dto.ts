import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDate, IsOptional, IsString } from 'class-validator';

/**
 * `GET /tracking-lists/:listId/series` query（FR-30，AC-30.1/30.3）。全域 ValidationPipe（whitelist +
 * forbidNonWhitelisted + transform）：未宣告欄位 / 非法值 → 400。
 *
 * - `from` / `to`：ISO 8601 觀測時點界（含端點過濾 `fetchedAt`）；空字串/缺值 → undefined（不設界，全時序）；
 *   無法解析為合法 Date → 400（`@IsDate` 拒 Invalid Date）。皆缺＝回全部時序。
 * - **時區解析（#471-2）**：無 offset 的輸入一律以 **UTC** 解讀——與 `new Date('2026-01-15')`（date-only）行為
 *   一致、**與部署伺服器時區無關**。JS 規範對「無 offset 的 date-**time**」（如 `2026-01-15T00:00:00`）以
 *   *伺服器本地時區* 解析，卻對 date-only 以 UTC 解析；此不一致會讓非 UTC 部署的視窗邊界位移一個 UTC offset
 *   （AC-30.3 邊界過濾錯位）。故先經 {@link normalizeIsoBoundary} 補 `Z`；顯式帶 offset（`Z` / `±HH:MM` /
 *   `±HHMM`）則尊重之、不改寫。
 * - `granularity`：**reserved / no-op**（AC-30.1 URL 明列，故必須接受以免 `forbidNonWhitelisted` 誤擋合法前端
 *   請求）。SSOT 未定義其取值或分桶語意，故本任務**不臆造分桶**——一律回原始觀測點（`fetchedAt` 粒度＝月粒度
 *   語意 S1）；分桶行為待 spec-first 補齊後再實作（見任務筆記待辦）。以 `@IsString` 寬鬆接受、不設值域白名單
 *   （避免暗示未實作的分級）。
 */
export class GetSeriesQueryDto {
  @ApiPropertyOptional({ type: String, format: 'date-time', description: '起始觀測時點（含）' })
  @IsOptional()
  @Transform(({ value }) => toOptionalDate(value))
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: '結束觀測時點（含）' })
  @IsOptional()
  @Transform(({ value }) => toOptionalDate(value))
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({ description: 'reserved（未定義分桶語意；目前回原始觀測點）' })
  @IsOptional()
  @IsString()
  granularity?: string;
}

/**
 * ISO 8601 邊界字串正規化（#471-2）：**無 offset 的 date-time → 補 `Z`（以 UTC 解讀）**，使解析結果與部署
 * 伺服器時區無關、且與 date-only（本就以 UTC 解析）一致。已帶時區指示（`Z` / `±HH:MM` / `±HHMM`）或
 * date-only（無時間段）→ 原樣返回；非 ISO 畸形字串亦原樣返回（交由下游 `new Date` → Invalid Date → 400）。
 */
export function normalizeIsoBoundary(raw: string): string {
  const hasTime = raw.includes('T');
  const hasOffset = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
  return hasTime && !hasOffset ? `${raw}Z` : raw;
}

/**
 * query string → Date。空字串 / 缺值 → undefined（不設界）；否則經 {@link normalizeIsoBoundary}（無 offset →
 * UTC）後 `new Date`——非法字串產生 Invalid Date，交由 `@IsDate` 拒為 400（不靜默吞掉畸形輸入）。
 */
function toOptionalDate(value: unknown): unknown {
  if (value === '' || value === undefined || value === null) {
    return undefined;
  }
  return new Date(normalizeIsoBoundary(value as string));
}
