import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { CurrentActor } from '../common/current-actor.decorator';
import { CaptureIngestDto } from './dto/capture-ingest.dto';
import { CapturesService } from './captures.service';
import type { IngestResult } from './captures.service';

/**
 * Capture ingestion HTTP 入口（T13.2，FR-36）。掛 `/api/v1/captures`（全域前綴）。全域 `CompositeAuthGuard`
 * （缺/錯認證→401，AC-36.4）、`CsrfGuard`（session 狀態變更需同源 Origin）、`ValidationPipe`（缺欄位/未知
 * source→400）均已套用。**獨立 body 上限**（`INGEST_BODY_LIMIT_MB`，AC-36.5）由 `configureApp` 為此路由掛的
 * 專屬 body parser 於全域 parser 之前守門（逾→413）；**批次上限**（`INGEST_BATCH_MAX`）於 service 層先於 DB 守門。
 *
 * owner 歸屬（AC-36.4）：`@CurrentActor()` 取已認證 actor 交 service 落 `ownerId`（session→user.id、apiKey→null）。
 */
@ApiTags('captures')
@Controller('captures')
export class CapturesController {
  constructor(private readonly service: CapturesService) {}

  /** 批次 push（AC-36.1）：`{source,schemaVersion,items[]}`→raw append-only；回 `202 {accepted,deduped,ids}`。 */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  ingest(
    @Body() dto: CaptureIngestDto,
    @CurrentActor() actor: AuthenticatedUser,
  ): Promise<IngestResult> {
    return this.service.ingest(dto, actor);
  }
}
