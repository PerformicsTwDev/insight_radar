import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ingestConfig } from '../config/ingest.config';
import { CapturesController } from './captures.controller';
import { CapturesService } from './captures.service';

/**
 * Capture ingestion 模組（T13.2，FR-36）。`PrismaService` 為全域模組（@Global），無需在此 import；
 * 批次/body 上限自 `ingestConfig`（`ConfigModule.forFeature`）。raw append-only 落 `captures`；per-source
 * mapper（T13.4）與 canonical 具名表（AiSearchCapture/SocialPost）為後續 Task。
 */
@Module({
  imports: [ConfigModule.forFeature(ingestConfig)],
  controllers: [CapturesController],
  providers: [CapturesService],
})
export class CapturesModule {}
