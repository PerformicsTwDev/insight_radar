import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from 'src/prisma';
import { createPrismaTestApp } from '../utils';

/**
 * T13.1（FR-36/37、Design §18.2/18.3/18.5 · Testcontainers 真 Postgres）：中立資料模型基座——
 * 驗新 migration 套用後 raw 層 `captures`（append-only、`@@unique([content_hash])` 去重、`owner_id` nullable
 * 機器來源）與 canonical 骨架 `ai_search_captures` / `social_posts`（建表可讀寫、metrics nullable S14）建表可用。
 * **本 task 僅 schema/migration，無 service 邏輯** → 只驗 DB 層語意（unique 撞重＝真 P2002）。content-hash 去重的
 * service 語意（回既有、計入 deduped）屬 T13.3、postKey 跨來源 merge 屬 M16，本檔不涉。
 */
describe('Neutral capture schema (integration · Testcontainers · T13.1 · FR-36/37)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    await prisma.aiSearchCapture.deleteMany();
    await prisma.socialPost.deleteMany();
    await prisma.capture.deleteMany();
  });

  describe('Capture (raw append-only, INV-4)', () => {
    const rawItem = (contentHash: string) => ({
      source: 'extension',
      schemaVersion: 'v1',
      channel: 'googleSearch',
      platform: null,
      contentHash,
      payload: { query: 'best running shoes', blocks: [{ text: 'Nike' }] },
      capturedAt: new Date('2026-07-20T02:00:00Z'),
    });

    it('creates and reads back a raw capture with defaults', async () => {
      const created = await prisma.capture.create({ data: rawItem('hash-crud-1') });

      const loaded = await prisma.capture.findUniqueOrThrow({ where: { id: created.id } });
      expect(loaded.source).toBe('extension');
      expect(loaded.schemaVersion).toBe('v1');
      expect(loaded.channel).toBe('googleSearch');
      expect(loaded.platform).toBeNull();
      expect(loaded.contentHash).toBe('hash-crud-1');
      expect(loaded.payload).toEqual({
        query: 'best running shoes',
        blocks: [{ text: 'Nike' }],
      });
      expect(loaded.mapStatus).toBe('ok'); // @default("ok")
      expect(loaded.capturedAt).toBeInstanceOf(Date);
      expect(loaded.createdAt).toBeInstanceOf(Date);
    });

    it('stores ownerId=null for machine (x-api-key) sources (FR-27)', async () => {
      const created = await prisma.capture.create({
        data: { ...rawItem('hash-owner-null'), ownerId: null },
      });
      const loaded = await prisma.capture.findUniqueOrThrow({ where: { id: created.id } });
      expect(loaded.ownerId).toBeNull();
    });

    it('associates a session-owned capture with its ownerId', async () => {
      const ownerId = randomUUID();
      const created = await prisma.capture.create({
        data: { ...rawItem('hash-owned'), ownerId },
      });
      const loaded = await prisma.capture.findUniqueOrThrow({ where: { id: created.id } });
      expect(loaded.ownerId).toBe(ownerId);
    });

    it('rejects a duplicate content_hash (S16 content-hash idempotency guard)', async () => {
      await prisma.capture.create({ data: rawItem('dup-hash') });

      await expect(prisma.capture.create({ data: rawItem('dup-hash') })).rejects.toMatchObject({
        code: 'P2002', // Prisma unique constraint violation on @@unique([contentHash])
      });
    });

    it('exposes @@unique([contentHash]) via the generated where filter', async () => {
      const created = await prisma.capture.create({ data: rawItem('hash-by-unique') });
      const byHash = await prisma.capture.findUnique({
        where: { contentHash: 'hash-by-unique' },
      });
      expect(byHash?.id).toBe(created.id);
    });
  });

  describe('AiSearchCapture (canonical skeleton, INV-5 · §18.3)', () => {
    it('inserts and reads back one row (neutral AI shape)', async () => {
      const jobId = randomUUID();
      const created = await prisma.aiSearchCapture.create({
        data: {
          jobId,
          channel: 'chatGpt',
          query: 'best running shoes 2026',
          source: 'extension',
          schemaVersion: 'v1',
          blocks: [{ text: 'Consider the Nike Pegasus.' }],
          references: [{ title: 'Nike', link: 'https://nike.com', index: 0 }],
          capturedAt: new Date('2026-07-20T02:00:00Z'),
        },
      });

      const loaded = await prisma.aiSearchCapture.findUniqueOrThrow({ where: { id: created.id } });
      expect(loaded.jobId).toBe(jobId);
      expect(loaded.channel).toBe('chatGpt');
      expect(loaded.query).toBe('best running shoes 2026');
      expect(loaded.source).toBe('extension');
      expect(loaded.blocks).toEqual([{ text: 'Consider the Nike Pegasus.' }]);
      expect(loaded.references).toEqual([{ title: 'Nike', link: 'https://nike.com', index: 0 }]);
      expect(loaded.ownerId).toBeNull(); // day-one owner-semantics column (FR-27), nullable
    });

    it('defaults references to an empty array (grounding absent → [], not fabricated)', async () => {
      const created = await prisma.aiSearchCapture.create({
        data: {
          jobId: randomUUID(),
          channel: 'geminiApp',
          query: 'noise cancelling headphones',
          source: 'extension',
          schemaVersion: 'v1',
          blocks: [],
          capturedAt: new Date('2026-07-20T02:00:00Z'),
        },
      });
      const loaded = await prisma.aiSearchCapture.findUniqueOrThrow({ where: { id: created.id } });
      expect(loaded.references).toEqual([]);
    });
  });

  describe('SocialPost (canonical skeleton, INV-5 · §18.5)', () => {
    const jobId = randomUUID();

    it('inserts and reads back one row with nullable metrics (S14)', async () => {
      const created = await prisma.socialPost.create({
        data: {
          jobId,
          platform: 'threads',
          postKey: 'threads.net/@user/post/1',
          source: 'extension',
          author: 'someone',
          content: 'These shoes are great',
          publishedAt: new Date('2026-07-19T18:00:00Z'),
          likes: 8000,
          comments: null, // metrics nullable — missing ≠ 0 (S14)
          reposts: null,
          shares: null,
          schemaVersion: 'v1',
          capturedAt: new Date('2026-07-20T02:00:00Z'),
        },
      });

      const loaded = await prisma.socialPost.findUniqueOrThrow({ where: { id: created.id } });
      expect(loaded.platform).toBe('threads');
      expect(loaded.postKey).toBe('threads.net/@user/post/1');
      expect(loaded.content).toBe('These shoes are great');
      expect(loaded.likes).toBe(8000);
      expect(loaded.comments).toBeNull();
      expect(loaded.reposts).toBeNull();
      expect(loaded.shares).toBeNull();
      expect(loaded.ownerId).toBeNull(); // day-one owner-semantics column (FR-27), nullable
    });

    it('enforces @@unique([jobId, postKey]) within a job (S13 dedup key)', async () => {
      const dupJob = randomUUID();
      const base = {
        jobId: dupJob,
        platform: 'threads',
        postKey: 'threads.net/@user/post/dup',
        source: 'extension',
        content: 'first',
        schemaVersion: 'v1',
        capturedAt: new Date('2026-07-20T02:00:00Z'),
      };
      await prisma.socialPost.create({ data: base });

      await expect(
        prisma.socialPost.create({ data: { ...base, content: 'second' } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('allows the same postKey under a different job (dedup is per-job)', async () => {
      const postKey = 'threads.net/@user/post/shared';
      const a = await prisma.socialPost.create({
        data: {
          jobId: randomUUID(),
          platform: 'threads',
          postKey,
          source: 'extension',
          content: 'a',
          schemaVersion: 'v1',
          capturedAt: new Date('2026-07-20T02:00:00Z'),
        },
      });
      const b = await prisma.socialPost.create({
        data: {
          jobId: randomUUID(),
          platform: 'threads',
          postKey,
          source: 'extension',
          content: 'b',
          schemaVersion: 'v1',
          capturedAt: new Date('2026-07-20T02:00:00Z'),
        },
      });
      expect(a.id).not.toBe(b.id);
    });
  });

  it('exports Prisma error namespace used by dedup guards', () => {
    // Guards against accidental removal of the Prisma import (keeps P2002 assertions meaningful).
    expect(Prisma.PrismaClientKnownRequestError).toBeDefined();
  });
});
