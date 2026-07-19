import { randomUUID } from 'node:crypto';
import { type INestApplication, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/authenticated-user';
import type { PrismaService } from 'src/prisma';
import { TopicRepository } from 'src/topics/topic.repository';
import { TrackingListService } from 'src/tracking/tracking-list.service';
import { createPrismaTestApp } from '../utils';

/**
 * TC-66（FR-30 / FR-27 · Testcontainers 真 Postgres）：`TrackingListService.getSeries` 的 **DB 層強制**——
 * 直接構造 service（真 prisma），驗真實 Postgres 語意：owner scope（越權/不存在→同一 404）、from/to `fetchedAt`
 * 含端點過濾、快照 scope 至**現有成員**（已移除成員遺留快照不造成孤 axis 點）、空狀態（無成員 / 無快照 →
 * axis=[]、latestFetchedAt=null、各成員 series=[]）、以及 axis 聯集 + per-member 對齊 + total + cpc 端到端。
 * 組裝正確性由 `src/tracking/volume-series.spec.ts` 純函式單測把關，兩者互補。HTTP 契約由
 * `test/e2e/tracking-list-series.e2e-spec.ts` 覆蓋。
 */

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const SESSION_A: AuthenticatedUser = { kind: 'session', id: OWNER_A, email: 'a@example.com' };
const SESSION_B: AuthenticatedUser = { kind: 'session', id: OWNER_B, email: 'b@example.com' };
const API_KEY: AuthenticatedUser = { kind: 'apiKey' };

const T0 = new Date('2026-01-01T00:00:00.000Z');
const T1 = new Date('2026-02-01T00:00:00.000Z');
const T2 = new Date('2026-03-01T00:00:00.000Z');

interface SnapSpec {
  normalizedText: string;
  fetchedAt: Date;
  avgMonthlySearches?: number | null;
  competition?: string | null;
  cpcLowMicros?: bigint | null;
  cpcHighMicros?: bigint | null;
}

describe('TrackingList series (integration · Testcontainers · TC-66 · FR-30/27)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: TrackingListService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    service = new TrackingListService(prisma, new TopicRepository(prisma), {
      maxLists: 50,
      maxMembersPerList: 500,
      maxItemsPerRequest: 500,
      backfillMonths: 12,
      refreshCron: '0 3 * * *',
      keepSeriesOnDelete: false,
      sweepLeaseMs: 3600000,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.volumeSnapshot.deleteMany();
    await prisma.trackingList.deleteMany(); // cascade removes members
  });

  /** 建清單（TW/zh-TW）+ 成員；回 listId。member = { text, normalizedText }。 */
  async function seedList(
    ownerId: string | null,
    members: { text: string; normalizedText: string }[],
  ): Promise<string> {
    const list = await prisma.trackingList.create({
      data: { ownerId, name: `list-${randomUUID()}`, geo: 'TW', language: 'zh-TW' },
    });
    for (const m of members) {
      await prisma.trackingListMember.create({
        data: { listId: list.id, normalizedText: m.normalizedText, text: m.text },
      });
    }
    return list.id;
  }

  async function seedSnaps(listId: string, specs: SnapSpec[]): Promise<void> {
    for (const s of specs) {
      await prisma.volumeSnapshot.create({
        data: {
          listId,
          normalizedText: s.normalizedText,
          geo: 'TW',
          language: 'zh-TW',
          avgMonthlySearches: s.avgMonthlySearches ?? null,
          competition: s.competition ?? null,
          cpcLowMicros: s.cpcLowMicros ?? null,
          cpcHighMicros: s.cpcHighMicros ?? null,
          fetchedAt: s.fetchedAt,
        },
      });
    }
  }

  describe('owner scope (AC-30.4 · FR-27)', () => {
    it('non-owner session → 404 (NotFoundException, before any series query)', async () => {
      const listId = await seedList(OWNER_A, [{ text: 'Coffee', normalizedText: 'coffee' }]);
      await expect(service.getSeries(listId, {}, SESSION_B)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('unknown listId → 404', async () => {
      await expect(service.getSeries(randomUUID(), {}, SESSION_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('apiKey (machine) reads any list → allowed', async () => {
      const listId = await seedList(OWNER_A, [{ text: 'Coffee', normalizedText: 'coffee' }]);
      await expect(service.getSeries(listId, {}, API_KEY)).resolves.toMatchObject({
        list: { listId },
      });
    });

    it('cross-list normalizedText collision isolated by listId (no other-list/owner leak)', async () => {
      // 兩個不同 owner 的清單各有同名成員 'coffee' + 各自快照（**不同 fetchedAt**——若 seriesWhere 漏掉
      // listId 只以 normalizedText scope，B 的 T1 快照會混入 A 的 axis/total，本測試即會紅）。
      const listA = await seedList(OWNER_A, [{ text: 'Coffee', normalizedText: 'coffee' }]);
      const listB = await seedList(OWNER_B, [{ text: 'Coffee', normalizedText: 'coffee' }]);
      await seedSnaps(listA, [
        { normalizedText: 'coffee', fetchedAt: T0, avgMonthlySearches: 100 },
      ]);
      await seedSnaps(listB, [
        { normalizedText: 'coffee', fetchedAt: T1, avgMonthlySearches: 999 },
      ]);

      const res = await service.getSeries(listA, {}, SESSION_A);
      expect(res.axis).toEqual([T0]); // 只含 A 的時點；B 的 T1 不得混入
      expect(res.total).toEqual([100]); // 只累計 A 的 100，不見 B 的 999
      expect(res.members[0].series.map((p) => p.avgMonthlySearches)).toEqual([100]);
      expect(res.members[0].latest?.avgMonthlySearches).toBe(100);
    });
  });

  describe('empty state (AC-30.3)', () => {
    it('list with no members → axis=[], latestFetchedAt=null, no members', async () => {
      const listId = await seedList(OWNER_A, []);
      const res = await service.getSeries(listId, {}, SESSION_A);
      expect(res.axis).toEqual([]);
      expect(res.total).toEqual([]);
      expect(res.members).toEqual([]);
      expect(res.summary).toEqual({ memberCount: 0, latestFetchedAt: null });
    });

    it('members but zero snapshots → each member series=[], latestFetchedAt=null', async () => {
      const listId = await seedList(OWNER_A, [{ text: 'Coffee', normalizedText: 'coffee' }]);
      const res = await service.getSeries(listId, {}, SESSION_A);
      expect(res.axis).toEqual([]);
      expect(res.summary.latestFetchedAt).toBeNull();
      expect(res.members).toHaveLength(1);
      expect(res.members[0].series).toEqual([]);
      expect(res.members[0].latest).toBeNull();
    });
  });

  describe('series assembly end-to-end (AC-30.1/30.2/30.5)', () => {
    it('axis union + breakpoints (null≠0) + total + latest + cpc via real DB', async () => {
      const listId = await seedList(OWNER_A, [
        { text: 'Coffee', normalizedText: 'coffee' },
        { text: 'Tea', normalizedText: 'tea' },
      ]);
      await seedSnaps(listId, [
        {
          normalizedText: 'coffee',
          fetchedAt: T0,
          avgMonthlySearches: 100,
          competition: 'LOW',
          cpcLowMicros: 500000n,
          cpcHighMicros: 1500000n,
        },
        // coffee 無 T1（store-on-change 略過）→ 斷點
        {
          normalizedText: 'coffee',
          fetchedAt: T2,
          avgMonthlySearches: 120,
          competition: 'HIGH',
          cpcLowMicros: 2500000n,
        },
        {
          normalizedText: 'tea',
          fetchedAt: T1,
          avgMonthlySearches: 50,
          competition: 'LOW',
          cpcLowMicros: null,
        },
      ]);

      const res = await service.getSeries(listId, {}, SESSION_A);

      expect(res.list).toMatchObject({ listId, geo: 'TW', language: 'zh-TW' });
      expect(typeof res.list.name).toBe('string');
      expect(res.axis).toEqual([T0, T1, T2]);
      expect(res.total).toEqual([100, 50, 120]);
      expect(res.summary).toEqual({ memberCount: 2, latestFetchedAt: T2 });

      const coffee = res.members.find((m) => m.normalizedText === 'coffee')!;
      expect(coffee.series.map((p) => p.avgMonthlySearches)).toEqual([100, null, 120]); // T1 斷點
      expect(coffee.series[0].cpc).toBe(0.5); // 500000 / 1e6
      expect(coffee.series[2].cpc).toBe(2.5);
      expect(coffee.latest).toMatchObject({ fetchedAt: T2, avgMonthlySearches: 120, cpc: 2.5 });
      expect(coffee.addedAt).toBeInstanceOf(Date);

      const tea = res.members.find((m) => m.normalizedText === 'tea')!;
      expect(tea.series.map((p) => p.avgMonthlySearches)).toEqual([null, 50, null]);
      expect(tea.series[1].cpc).toBeNull(); // null micros → null（不補 0）
      expect(tea.latest).toMatchObject({ fetchedAt: T1, avgMonthlySearches: 50, cpc: null });
    });

    it('snapshots of a removed member are excluded (no orphan axis point)', async () => {
      const listId = await seedList(OWNER_A, [{ text: 'Coffee', normalizedText: 'coffee' }]);
      await seedSnaps(listId, [
        { normalizedText: 'coffee', fetchedAt: T1, avgMonthlySearches: 100 },
        // 'ghost' 曾是成員、已移除；其快照仍在（append-only），但不應污染 axis
        { normalizedText: 'ghost', fetchedAt: T0, avgMonthlySearches: 999 },
      ]);

      const res = await service.getSeries(listId, {}, SESSION_A);
      expect(res.axis).toEqual([T1]); // 只含現有成員 coffee 的 T1（T0 孤點被排除）
      expect(res.members.map((m) => m.normalizedText)).toEqual(['coffee']);
      expect(res.total).toEqual([100]);
    });
  });

  describe('from/to fetchedAt inclusive filtering (AC-30.3)', () => {
    const seed = async (): Promise<string> => {
      const listId = await seedList(OWNER_A, [{ text: 'Coffee', normalizedText: 'coffee' }]);
      await seedSnaps(listId, [
        { normalizedText: 'coffee', fetchedAt: T0, avgMonthlySearches: 10 },
        { normalizedText: 'coffee', fetchedAt: T1, avgMonthlySearches: 20 },
        { normalizedText: 'coffee', fetchedAt: T2, avgMonthlySearches: 30 },
      ]);
      return listId;
    };

    it('from only → fetchedAt >= from (inclusive)', async () => {
      const listId = await seed();
      const res = await service.getSeries(listId, { from: T1 }, SESSION_A);
      expect(res.axis).toEqual([T1, T2]);
      expect(res.total).toEqual([20, 30]);
    });

    it('to only → fetchedAt <= to (inclusive)', async () => {
      const listId = await seed();
      const res = await service.getSeries(listId, { to: T1 }, SESSION_A);
      expect(res.axis).toEqual([T0, T1]);
    });

    it('to bounds the chart window but latest stays the member actual most-recent (#471-1 · AC-30.5)', async () => {
      const listId = await seed(); // snapshots at T0(10), T1(20), T2(30)
      const res = await service.getSeries(listId, { to: T1 }, SESSION_A);
      // chart 尊重 to：axis 只到 T1
      expect(res.axis).toEqual([T0, T1]);
      expect(res.summary.latestFetchedAt).toEqual(T1);
      // 但成員表 latest = 成員實際最新（T2，在 to 之外），非 windowed 內最新（T1）
      expect(res.members[0].latest).toMatchObject({ fetchedAt: T2, avgMonthlySearches: 30 });
    });

    it('window excluding all snapshots → empty series but latest still the member most-recent (#471-1)', async () => {
      const listId = await seed(); // snapshots at T0/T1/T2
      const res = await service.getSeries(
        listId,
        { from: new Date('2027-01-01T00:00:00.000Z') },
        SESSION_A,
      );
      expect(res.axis).toEqual([]); // 空狀態 chart（不回假 0 線）
      expect(res.summary.latestFetchedAt).toBeNull();
      expect(res.members[0].series).toEqual([]);
      // member table 非 windowed：latest 仍為實際最新 T2
      expect(res.members[0].latest).toMatchObject({ fetchedAt: T2, avgMonthlySearches: 30 });
    });

    it('both from and to → closed interval [from,to] inclusive', async () => {
      const listId = await seed();
      const res = await service.getSeries(listId, { from: T1, to: T1 }, SESSION_A);
      expect(res.axis).toEqual([T1]);
      expect(res.total).toEqual([20]);
    });

    it('range excluding all snapshots → empty state (not a fake 0 line)', async () => {
      const listId = await seed();
      const res = await service.getSeries(
        listId,
        { from: new Date('2027-01-01T00:00:00.000Z') },
        SESSION_A,
      );
      expect(res.axis).toEqual([]);
      expect(res.summary.latestFetchedAt).toBeNull();
      expect(res.members[0].series).toEqual([]);
    });
  });
});
