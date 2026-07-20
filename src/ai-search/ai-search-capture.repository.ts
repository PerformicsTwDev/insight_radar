import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CaptureChannel, CaptureSource } from '../captures/dto/capture-ingest.dto';
import type { AiSearchCanonical } from '../captures/mapping/canonical.types';
import { PrismaService } from '../prisma';

/** 供 mapper 收斂的一筆 raw extension capture（自 `captures` append-only 層）。 */
export interface RawExtensionCapture {
  source: CaptureSource;
  schemaVersion: string;
  channel: CaptureChannel;
  payload: unknown;
  capturedAt: Date;
}

/**
 * AI Search 合流落列持久層（T14.6，FR-41/AC-41.2；Design §18.3）。canonical `AiSearchCapture` 以 `jobId`（=runId）
 * 關聯——兩來源（extension push / SerpAPI pull）收斂後皆落此表。raw extension capture 由 `POST /captures`（T13.2）先落
 * `captures`（append-only），本 repo 讀出供 job 內以 `mapAiCapture`（T14.4 純函式）收斂 + 依 query 集合流。
 */
@Injectable()
export class AiSearchCaptureRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 讀 owner 範圍內、指定 extension 渠道的 raw capture（供 processor 以 mapper 收斂 + 依 query 集過濾合流）。
   * owner 過濾：session→該 owner、機器 x-api-key→null（各自範圍，S8）。source 固定 `extension`（primary push）。
   *
   * **有界掃描（M14-R3/#579 [8]，Design §18.3）**：`capturedAfter` 為 `capturedAt` 回溯下界（視窗主界）+ `limit` 為
   * `take` 上限（`capturedAt desc`，病態量安全上限）——**絕不**無界掃全 owner+渠道歷史 capture + 全 payload。走
   * `@@index([source, channel, capturedAt])`。keyword 過濾由 processor 於 `mapAiCapture` 抽取 query 後施加（query 在
   * payload JSON、非 column，且須 `normalizeText` 才可比對）。
   */
  async readRawExtensionCaptures(input: {
    ownerId: string | null;
    channels: CaptureChannel[];
    capturedAfter: Date;
    limit: number;
  }): Promise<RawExtensionCapture[]> {
    if (input.channels.length === 0) {
      return [];
    }
    const rows = await this.prisma.capture.findMany({
      where: {
        source: 'extension',
        channel: { in: input.channels },
        ownerId: input.ownerId,
        capturedAt: { gte: input.capturedAfter },
      },
      orderBy: { capturedAt: 'desc' },
      take: input.limit,
      select: { source: true, schemaVersion: true, channel: true, payload: true, capturedAt: true },
    });
    return rows.map((row) => ({
      source: row.source as CaptureSource,
      schemaVersion: row.schemaVersion,
      channel: row.channel as CaptureChannel,
      payload: row.payload,
      capturedAt: row.capturedAt,
    }));
  }

  /** 清掉本 job 既有合流列（重入列/reset 時 clean slate，避免重複落列；idempotent re-run）。 */
  async deleteByJobId(jobId: string): Promise<void> {
    await this.prisma.aiSearchCapture.deleteMany({ where: { jobId } });
  }

  /** 落合流列（兩來源收斂後的 canonical，皆以 jobId 關聯）；回落列筆數。 */
  async persistCanonical(
    jobId: string,
    ownerId: string | null,
    captures: AiSearchCanonical[],
  ): Promise<number> {
    if (captures.length === 0) {
      return 0;
    }
    const result = await this.prisma.aiSearchCapture.createMany({
      data: captures.map((capture) => ({
        ownerId,
        jobId,
        channel: capture.channel,
        query: capture.query,
        source: capture.source,
        schemaVersion: capture.schemaVersion,
        blocks: capture.blocks as Prisma.InputJsonValue,
        references: capture.references as unknown as Prisma.InputJsonValue,
        capturedAt: new Date(capture.capturedAt),
      })),
    });
    return result.count;
  }
}
