import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from 'src/prisma';
import { createPrismaTestApp } from '../utils';

/**
 * T11.1 (FR-28/29/27) — the M11 tracking data model on real Postgres
 * (Testcontainers): `TrackingList` / `TrackingListMember` / `VolumeSnapshot`
 * (Design §17.3). Verifies the constraints the schema promises —
 * `@@unique([ownerId,name])` (same-owner list-name unique), `@@id([listId,
 * normalizedText])` (dedup key), member `onDelete: Cascade`, append-only snapshots
 * with `null` preserved (never coerced to 0). `ownerId` exists from day one (FR-27).
 */
describe('tracking schema (integration · Testcontainers, T11.1 / FR-28)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.volumeSnapshot.deleteMany();
    await prisma.trackingList.deleteMany(); // cascade removes members
  });

  const OWNER = randomUUID();

  const makeList = (over: { name?: string; ownerId?: string | null } = {}) =>
    prisma.trackingList.create({
      data: { ownerId: OWNER, name: 'shoes', geo: 'TW', language: 'zh-TW', ...over },
    });

  it('creates a list + member + snapshot; ownerId present from day one (FR-27)', async () => {
    const list = await makeList();
    expect(list.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(list.ownerId).toBe(OWNER);

    await prisma.trackingListMember.create({
      data: { listId: list.id, normalizedText: 'running shoes', text: 'Running Shoes' },
    });
    const snap = await prisma.volumeSnapshot.create({
      data: {
        listId: list.id,
        normalizedText: 'running shoes',
        geo: 'TW',
        language: 'zh-TW',
        avgMonthlySearches: null,
        competition: null,
        competitionIndex: null,
        cpcLowMicros: null,
        cpcHighMicros: null,
      },
    });
    expect(snap.avgMonthlySearches).toBeNull(); // null ≠ 0 (S1/C12)
    expect(snap.monthlyVolumes).toEqual([]); // Json @default("[]")

    const found = await prisma.trackingList.findUnique({
      where: { id: list.id },
      include: { members: true },
    });
    expect(found?.geo).toBe('TW');
    expect(found?.members).toHaveLength(1);
    expect(found?.members[0].lastCheckedAt).toBeNull();
  });

  it('enforces @@unique([ownerId, name]) — same owner cannot reuse a list name', async () => {
    await makeList({ name: 'dup' });
    // Prisma unique-constraint violation → P2002 (explicit intent, not just any throw).
    await expect(makeList({ name: 'dup' })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows the same list name for a different owner', async () => {
    await makeList({ name: 'shared' });
    await expect(
      prisma.trackingList.create({
        data: { ownerId: randomUUID(), name: 'shared', geo: 'TW', language: 'zh-TW' },
      }),
    ).resolves.toMatchObject({ name: 'shared' });
  });

  it('enforces @@id([listId, normalizedText]) — a member is unique per list', async () => {
    const list = await makeList();
    await prisma.trackingListMember.create({
      data: { listId: list.id, normalizedText: 'kw', text: 'kw' },
    });
    await expect(
      prisma.trackingListMember.create({
        data: { listId: list.id, normalizedText: 'kw', text: 'kw again' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('cascade-deletes members when the list is deleted (onDelete: Cascade)', async () => {
    const list = await makeList();
    await prisma.trackingListMember.create({
      data: { listId: list.id, normalizedText: 'a', text: 'a' },
    });
    await prisma.trackingList.delete({ where: { id: list.id } });
    expect(await prisma.trackingListMember.count({ where: { listId: list.id } })).toBe(0);
  });

  it('stores append-only snapshots per member ordered by fetchedAt (store-on-change series)', async () => {
    const list = await makeList();
    await prisma.trackingListMember.create({
      data: { listId: list.id, normalizedText: 'kw', text: 'kw' },
    });
    const base = { listId: list.id, normalizedText: 'kw', geo: 'TW', language: 'zh-TW' };
    await prisma.volumeSnapshot.create({ data: { ...base, avgMonthlySearches: 100 } });
    await prisma.volumeSnapshot.create({ data: { ...base, avgMonthlySearches: 120 } });

    const series = await prisma.volumeSnapshot.findMany({
      where: { listId: list.id, normalizedText: 'kw' },
      orderBy: { fetchedAt: 'asc' },
    });
    expect(series.map((s) => s.avgMonthlySearches)).toEqual([100n, 120n]);
  });

  it('stores avg_monthly_searches beyond INT4 range — Ads int64 mega-term (#469 BIGINT)', async () => {
    // Google Ads `avgMonthlySearches` is int64; a mega-term can exceed INT4 max
    // (2,147,483,647). On the old INTEGER column this insert failed with Postgres
    // 'integer out of range'; the column must be BIGINT so the snapshot lands and
    // reads back exactly (value stays JS-number-safe below 2^53 at read boundaries).
    const list = await makeList();
    await prisma.trackingListMember.create({
      data: { listId: list.id, normalizedText: 'kw', text: 'kw' },
    });
    const MEGA = 3_000_000_000; // > INT4 max; well under 2^53
    const snap = await prisma.volumeSnapshot.create({
      data: {
        listId: list.id,
        normalizedText: 'kw',
        geo: 'TW',
        language: 'zh-TW',
        avgMonthlySearches: MEGA,
      },
    });
    expect(snap.avgMonthlySearches).toBe(3_000_000_000n); // Prisma BigInt read-back
    const read = await prisma.volumeSnapshot.findFirstOrThrow({
      where: { listId: list.id, normalizedText: 'kw' },
    });
    expect(read.avgMonthlySearches).toBe(3_000_000_000n); // exact round-trip, no overflow
  });
});
