import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, PayloadTooLargeException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { ownerIdOf } from '../common/owner-scope';
import { ingestConfig } from '../config/ingest.config';
import { PrismaService } from '../prisma/prisma.service';
import { captureContentHash } from './content-hash';
import type { CaptureIngestDto } from './dto/capture-ingest.dto';

/** `POST /captures` 回應（AC-36.1）：`accepted`＝本請求新落列數、`deduped`＝命中既有列數、`ids`＝各筆（逐輸入 item 對齊）id。 */
export interface IngestResult {
  accepted: number;
  deduped: number;
  ids: string[];
}

/** 批次超上限訊息（AC-36.5；`INGEST_BATCH_MAX`）。 */
export function tooManyItemsMessage(max: number): string {
  return `Batch exceeds INGEST_BATCH_MAX (${max})`;
}

/** schemaVersion 不在 allowlist 訊息（AC-36.3 / S15；不回傳 allowlist 內容，避免洩漏設定）。 */
export function unacceptedSchemaVersionMessage(version: string): string {
  return `Unsupported schemaVersion "${version}" (not in CAPTURE_ACCEPTED_SCHEMA_VERSIONS)`;
}

/**
 * Capture ingestion service（T13.2 端點 + T13.3 idempotency，FR-36）。把 `POST /captures` 的批次 payload 逐筆落
 * raw append-only 層（`captures`），並以 **content-hash idempotency**（S16）去重。
 *
 * **去重鍵（S16；owner-scoped，M13-R1/#552）**：`contentHash = sha256(canonical(ownerId?, source,
 * schemaVersion, item))`（`captures.content_hash` NOT NULL + 全域 `@@unique`；`ownerId` fold 入 hash 使去重
 * 天然 owner-scoped——回讀 `where contentHash in [...]` 因 hash 已編碼 owner 而不跨租戶）。去重語意（AC-36.2）：
 * - **同批內**同 hash → 只落一列（first occurrence），重複位置回同一 id、計入 `deduped`。
 * - **跨批重送**同內容 → 命中既有列、**不重複落列、不覆寫**（raw append-only），回既有 id、計入 `deduped`。
 * - **並發同 hash** → 以 `createMany({ skipDuplicates })` 的 `ON CONFLICT DO NOTHING` 讓 DB `@@unique`
 *   為最終仲裁（NFR-8/17，並發下仍 idempotent、**不拋 P2002**）；回讀權威 id 對帳。
 *
 * `accepted` **只計本請求實際落列者**——回讀後以「該 hash 的權威 id === 本請求 mint 的 uuid」精確判定（uuid 全域
 * 唯一，含並發下亦不重複計）；`ids` 逐輸入 item 對齊（長度＝輸入數），`accepted + deduped === items.length`。
 *
 * **schemaVersion allowlist（S15 / AC-36.3）**：缺（DTO 擋）或值不在 `CAPTURE_ACCEPTED_SCHEMA_VERSIONS` →
 * `400`（**於 DB 前**、不靜默套預設、不猜形狀）。owner 歸屬（FR-27 / AC-36.4）：session→`actor.id`、apiKey→`null`
 * （唯一強制點在此 service 落庫）。`capturedAt`＝收件時點（raw 層）；來源內容真實時間由 per-source mapper（T13.4）抽取。
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
    // schemaVersion allowlist（S15 / AC-36.3）：缺省由 DTO 擋非空；此處斷言值在 allowlist，不合 → 400（DB 前）。
    if (!this.config.acceptedSchemaVersions.includes(dto.schemaVersion)) {
      throw new BadRequestException(unacceptedSchemaVersionMessage(dto.schemaVersion));
    }

    const ownerId = ownerIdOf(actor);
    const capturedAt = new Date();

    // 逐輸入 item 的 content-hash（S16；owner-scoped，M13-R1/#552），與輸入順序對齊——供最終 `ids` 逐筆回填。
    // `ownerId` fold 入 hash：不同 session owner 同內容 → 不同 hash（各落自己一列、各回自己 id，杜絕跨租戶
    // ON CONFLICT DO NOTHING 回不可讀 id/丟列）；機器 null-owner 間 → 同 hash → 全域去重（S12b line 1863）。
    const hashes = dto.items.map((item) =>
      captureContentHash({ ownerId, source: dto.source, schemaVersion: dto.schemaVersion, item }),
    );

    // 同批內去重：每個 distinct hash 取首次出現、mint 一個候選列（uuid 供並發下精確判定「誰落了列」）。
    const distinct: { contentHash: string; id: string; row: Prisma.CaptureCreateManyInput }[] = [];
    const seen = new Set<string>();
    dto.items.forEach((item, index) => {
      const contentHash = hashes[index];
      if (seen.has(contentHash)) {
        return;
      }
      seen.add(contentHash);
      const id = randomUUID();
      distinct.push({
        contentHash,
        id,
        row: {
          id,
          ownerId,
          source: dto.source,
          schemaVersion: dto.schemaVersion,
          channel: dto.channel ?? null,
          platform: dto.platform ?? null,
          contentHash,
          payload: item as Prisma.InputJsonValue,
          capturedAt,
        },
      });
    });

    // ON CONFLICT DO NOTHING：撞 `@@unique([content_hash])` 者跳過（raw append-only、不覆寫、並發安全）。
    await this.prisma.capture.createMany({
      data: distinct.map((entry) => entry.row),
      skipDuplicates: true,
    });

    // 回讀每個 distinct hash 的權威 id（既有列或本請求新落列，皆已存在於 DB）。
    const persisted = await this.prisma.capture.findMany({
      where: { contentHash: { in: distinct.map((entry) => entry.contentHash) } },
      select: { id: true, contentHash: true },
    });
    const idByHash = new Map(persisted.map((row) => [row.contentHash, row.id]));

    // accepted 只計本請求實際落列者：權威 id === 本請求 mint 的 uuid（並發下唯一贏家才相等）。
    let accepted = 0;
    for (const entry of distinct) {
      if (idByHash.get(entry.contentHash) === entry.id) {
        accepted += 1;
      }
    }

    const ids = hashes.map((contentHash) => idByHash.get(contentHash) as string);
    return { accepted, deduped: dto.items.length - accepted, ids };
  }
}
