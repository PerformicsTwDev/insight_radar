import { randomUUID } from 'node:crypto';
import { BadRequestException, type INestApplication } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CapturesService } from 'src/captures/captures.service';
import type { CaptureIngestDto } from 'src/captures/dto/capture-ingest.dto';
import type { AuthenticatedUser } from 'src/common/authenticated-user';
import type { ingestConfig } from 'src/config/ingest.config';
import type { PrismaService } from 'src/prisma';
import { createPrismaTestApp } from '../utils';

/**
 * TC-72（dedup 部分，T13.3 · FR-36 AC-36.2/36.3 · NFR-17 · Testcontainers 真 Postgres）：**content-hash
 * idempotency** 的去重行為與 **schemaVersion allowlist** 的 DB 層驗證。
 *
 * T13.2 已算誠實 `contentHash`（`deduped` 恆 0、逐筆 append）；本檔驗 T13.3 接上的**真去重**——需真 Postgres
 * `@@unique([content_hash])` 才能證：同內容重送不重複落列（append-only、不覆寫）、並發同 hash 只落一列
 * （DB unique 為最終仲裁，NFR-8/17）、同批內同 hash 去重。allowlist 缺/不合 → `400`（DB 前，S15）。
 *
 * 純 hash 計算的鍵序無關性由 `src/captures/content-hash.spec.ts` 覆蓋；本檔專攻 service 編排 + DB 去重語意。
 */

const SESSION = (id: string): AuthenticatedUser => ({ kind: 'session', id, email: `${id}@x.test` });

const makeConfig = (
  over: Partial<ConfigType<typeof ingestConfig>> = {},
): ConfigType<typeof ingestConfig> => ({
  batchMax: 500,
  bodyLimitMb: 10,
  acceptedSchemaVersions: ['v1', 'v2'],
  bridgeRequiredFeatures: ['threadsSearch', 'googleSerp', 'chatGpt'],
  ...over,
});

const dto = (over: Partial<CaptureIngestDto> = {}): CaptureIngestDto => ({
  source: 'extension',
  channel: 'chatGpt',
  schemaVersion: 'v1',
  items: [{ query: 'running shoes', answer: 'A' }],
  ...over,
});

describe('Capture content-hash idempotency (integration · Testcontainers · TC-72 · FR-36 · NFR-17)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    await prisma.capture.deleteMany();
  });

  const makeService = (config = makeConfig()): CapturesService =>
    new CapturesService(prisma, config);

  describe('content-hash idempotency — resend same content (AC-36.2)', () => {
    it('second send of identical content → deduped=1, same id, table keeps one row (append-only, no overwrite)', async () => {
      const svc = makeService();
      const owner = SESSION(randomUUID());
      const body = dto();

      const first = await svc.ingest(body, owner);
      expect(first.accepted).toBe(1);
      expect(first.deduped).toBe(0);
      expect(first.ids).toHaveLength(1);

      const second = await svc.ingest(body, owner);
      expect(second.accepted).toBe(0);
      expect(second.deduped).toBe(1);
      // 回其既有 id（不 mint 新 id）。
      expect(second.ids).toEqual(first.ids);

      // raw append-only：撞重不重複落列、不覆寫。
      expect(await prisma.capture.count()).toBe(1);
      const row = await prisma.capture.findUniqueOrThrow({ where: { id: first.ids[0] } });
      expect(row.payload).toEqual({ query: 'running shoes', answer: 'A' });
    });

    it('key-order-different but semantically-identical item dedups (canonical hash)', async () => {
      const svc = makeService();
      const owner = SESSION(randomUUID());

      const first = await svc.ingest(dto({ items: [{ query: 'a', answer: 'b' }] }), owner);
      const second = await svc.ingest(dto({ items: [{ answer: 'b', query: 'a' }] }), owner);

      expect(second.deduped).toBe(1);
      expect(second.accepted).toBe(0);
      expect(second.ids).toEqual(first.ids);
      expect(await prisma.capture.count()).toBe(1);
    });
  });

  describe('content-hash idempotency — same hash within one batch (AC-36.2)', () => {
    it('in-batch duplicate item → one row, accepted counts distinct, deduped counts repeats', async () => {
      const svc = makeService();
      const owner = SESSION(randomUUID());

      const res = await svc.ingest(dto({ items: [{ q: 'a' }, { q: 'a' }, { q: 'b' }] }), owner);

      // 兩 distinct（{q:'a'}、{q:'b'}）落列、重複的 {q:'a'} 去重。
      expect(res.accepted).toBe(2);
      expect(res.deduped).toBe(1);
      // ids 逐筆對齊輸入 items（長度＝輸入數），重複位置回同一 id。
      expect(res.ids).toHaveLength(3);
      expect(res.ids[0]).toBe(res.ids[1]);
      expect(res.ids[2]).not.toBe(res.ids[0]);
      expect(await prisma.capture.count()).toBe(2);
    });
  });

  describe('content-hash idempotency — concurrent same hash (NFR-8/17)', () => {
    it('Promise.all of identical single-item requests → exactly one row, exactly one accepted, all same id', async () => {
      const svc = makeService();
      const owner = SESSION(randomUUID());
      const body = dto({ items: [{ query: 'concurrent', answer: 'X' }] });

      const N = 8;
      const results = await Promise.all(Array.from({ length: N }, () => svc.ingest(body, owner)));

      // DB @@unique([content_hash]) 為最終仲裁：恰一列落庫。
      expect(await prisma.capture.count()).toBe(1);
      // 恰一個請求新建、其餘皆去重（accepted 只計新落列）。
      const totalAccepted = results.reduce((sum, r) => sum + r.accepted, 0);
      const totalDeduped = results.reduce((sum, r) => sum + r.deduped, 0);
      expect(totalAccepted).toBe(1);
      expect(totalDeduped).toBe(N - 1);
      // 所有請求回同一既有 id。
      const ids = new Set(results.flatMap((r) => r.ids));
      expect(ids.size).toBe(1);
    });
  });

  describe('schemaVersion allowlist (AC-36.3 · S15)', () => {
    it('schemaVersion not in CAPTURE_ACCEPTED_SCHEMA_VERSIONS → 400, nothing persisted', async () => {
      const svc = makeService(makeConfig({ acceptedSchemaVersions: ['v1'] }));
      const owner = SESSION(randomUUID());

      await expect(svc.ingest(dto({ schemaVersion: 'v9' }), owner)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // 於 DB 前拒絕：不落任何列。
      expect(await prisma.capture.count()).toBe(0);
    });

    it('schemaVersion within allowlist → accepted (persists)', async () => {
      const svc = makeService(makeConfig({ acceptedSchemaVersions: ['v1', 'v2'] }));
      const owner = SESSION(randomUUID());

      const res = await svc.ingest(dto({ schemaVersion: 'v2' }), owner);
      expect(res.accepted).toBe(1);
      expect(await prisma.capture.count()).toBe(1);
    });
  });
});
