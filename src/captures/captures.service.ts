import { randomUUID } from 'node:crypto';
import { Inject, Injectable, PayloadTooLargeException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { ownerIdOf } from '../common/owner-scope';
import { ingestConfig } from '../config/ingest.config';
import { PrismaService } from '../prisma/prisma.service';
import { captureContentHash } from './content-hash';
import type { CaptureIngestDto } from './dto/capture-ingest.dto';

/** `POST /captures` 回應（AC-36.1）：`accepted`＝落庫筆數、`deduped`＝重複命中筆數（T13.2 恆 0）、`ids`＝各筆 id。 */
export interface IngestResult {
  accepted: number;
  deduped: number;
  ids: string[];
}

/** 批次超上限訊息（AC-36.5；`INGEST_BATCH_MAX`）。 */
export function tooManyItemsMessage(max: number): string {
  return `Batch exceeds INGEST_BATCH_MAX (${max})`;
}

/**
 * Capture ingestion service（T13.2，FR-36）。把 `POST /captures` 的批次 payload 逐筆落 raw append-only 層
 * （`captures`）。
 *
 * **T13.2 邊界**：端點 + 基本 raw 落庫 + 回應形狀。`contentHash` 為 NOT NULL + `@@unique`，故此處即算出
 * `sha256(canonical(source,schemaVersion,item))`（S16 唯一去重鍵）並落庫；但 **content-hash idempotency 的
 * 去重行為**（同 hash 命中→回既有 id、計入 `deduped`、ON CONFLICT/慢路徑 fallback）與 **`schemaVersion`
 * allowlist**（S15）屬 **T13.3**——本 task 一律 `deduped=0`、逐筆 append（不查既有、不 skipDuplicates）。
 *
 * owner 歸屬（FR-27 / AC-36.4）在此 service 落庫（唯一強制點）：session→`actor.id`、apiKey→`null`（不回填）。
 * `capturedAt`＝收件時點（raw 層）；來源內容的真實時間（貼文發佈時間等）由 per-source mapper（T13.4）自
 * `payload` 抽進 canonical 層。
 */
@Injectable()
export class CapturesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ingestConfig.KEY) private readonly config: ConfigType<typeof ingestConfig>,
  ) {}

  async ingest(dto: CaptureIngestDto, actor: AuthenticatedUser): Promise<IngestResult> {
    // 請求形狀守門（AC-36.5 / NFR-17）：先於 contentHash 計算與任何 DB 存取，把超大批次擋在放大之前。
    if (dto.items.length > this.config.batchMax) {
      throw new PayloadTooLargeException(tooManyItemsMessage(this.config.batchMax));
    }

    const ownerId = ownerIdOf(actor);
    const capturedAt = new Date();
    const rows: Prisma.CaptureCreateManyInput[] = dto.items.map((item) => ({
      id: randomUUID(),
      ownerId,
      source: dto.source,
      schemaVersion: dto.schemaVersion,
      channel: dto.channel ?? null,
      platform: dto.platform ?? null,
      contentHash: captureContentHash({
        source: dto.source,
        schemaVersion: dto.schemaVersion,
        item,
      }),
      payload: item as Prisma.InputJsonValue,
      capturedAt,
    }));

    await this.prisma.capture.createMany({ data: rows });

    // deduped 恆 0：content-hash 去重回既有 id 屬 T13.3（本 task 逐筆 append、不查既有）。
    return { accepted: rows.length, deduped: 0, ids: rows.map((row) => row.id as string) };
  }
}
