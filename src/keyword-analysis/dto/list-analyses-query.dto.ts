import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

/** JobStatus 值（Prisma enum 的字面複本；供 `status` 過濾白名單，未知值→400）。 */
export const JOB_STATUS_VALUES = [
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'canceled',
] as const;
export type JobStatusValue = (typeof JOB_STATUS_VALUES)[number];

/**
 * `GET /keyword-analyses` 歷史清單 query（FR-23）。全域 ValidationPipe（transform）把字串 query 轉數值；
 * 未知 `status` → 400（`@IsIn`）；`pageSize` 上限由 service 對 `QUERY_MAX_PAGE_SIZE` 把關（沿用讀取層，AC-23.3）。
 */
export class ListAnalysesQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, description: '上限＝QUERY_MAX_PAGE_SIZE（超過→400）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @ApiPropertyOptional({ enum: JOB_STATUS_VALUES })
  @IsOptional()
  @IsIn(JOB_STATUS_VALUES)
  status?: JobStatusValue;
}
