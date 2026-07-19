import { randomUUID } from 'node:crypto';
import { NotFoundException, type INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdsClient,
  GenerateKeywordHistoricalMetricsRequest,
  GenerateKeywordIdeasRequest,
  KeywordHistoricalResult,
  KeywordIdeaResult,
  RawKeywordIdeaMetrics,
} from 'src/google-ads/ads-client.port';
import type { AdsThrottle } from 'src/google-ads/ads-rate-limiter';
import { GoogleAdsService } from 'src/google-ads/google-ads.service';
import { normalizeText } from 'src/google-ads/normalize';
import type { PrismaService } from 'src/prisma';
import { VolumeRefreshService } from 'src/tracking/volume-refresh.service';
import { createPrismaTestApp } from '../utils';

/**
 * TC-65（FR-29 / NFR-16 · Testcontainers 真 Postgres）：`VolumeRefreshService.refreshList` 的
 * store-on-change dedup + null 不補 0 + 月粒度（MonthOfYear 名稱映射）+ 降級不阻斷（partial）+
 * exact 模式經 `GoogleAdsService.fetchHistoricalMetrics`（既有 adapter + AdsRateLimiter 路徑，每批 ≤20）。
 *
 * Ads 為 fake（golden 形狀），DB 為真 Postgres。真限流器另由 `ads-rate-limiter.spec` 覆蓋；此處以
 * recording `AdsThrottle` 斷言**每次 Ads 呼叫都經節流器**（refresh 不繞過限流、不放大 QPS）。
 */

type Month = { year: number; month: string; searches: number | null };
type MetricSpec =
  | {
      kind: 'metrics';
      avg: number | null;
      competition: string;
      competitionIndex: number | null;
      lowMicros: string | null;
      highMicros: string | null;
      months: Month[];
      /** 近義聚合：此字為 canonical、涵蓋這些 close variant（上游不另回 variant 列，AC-13.2/T1.9）。 */
      closeVariants?: string[];
    }
  | { kind: 'omit' } // 上游無此字資料 → fetchHistoricalMetrics 補 all-null seed 列
  | { kind: 'throw' }; // 含此字的批 → Ads 失敗（模擬重試耗盡）

function toRaw(spec: Extract<MetricSpec, { kind: 'metrics' }>): RawKeywordIdeaMetrics {
  return {
    avg_monthly_searches: spec.avg,
    competition: spec.competition,
    competition_index: spec.competitionIndex,
    low_top_of_page_bid_micros: spec.lowMicros,
    high_top_of_page_bid_micros: spec.highMicros,
    monthly_search_volumes: spec.months.map((m) => ({
      year: m.year,
      month: m.month,
      monthly_searches: m.searches,
    })),
  };
}

class FakeAdsClient implements AdsClient {
  ideasCalls = 0;
  histCalls: string[][] = [];
  readonly specs = new Map<string, MetricSpec>();

  generateKeywordIdeas(_req: GenerateKeywordIdeasRequest): Promise<KeywordIdeaResult[]> {
    this.ideasCalls += 1; // 指定模式**絕不**走拓展端點
    return Promise.resolve([]);
  }

  generateKeywordHistoricalMetrics(
    req: GenerateKeywordHistoricalMetricsRequest,
  ): Promise<KeywordHistoricalResult[]> {
    this.histCalls.push(req.keywords);
    for (const kw of req.keywords) {
      if (this.specs.get(normalizeText(kw))?.kind === 'throw') {
        return Promise.reject(new Error('ads boom (retries exhausted)'));
      }
    }
    // 近義聚合：canonical 涵蓋的 variant 由 canonical 列帶出（close_variants），不另回 variant 列。
    const variantKeys = new Set<string>();
    for (const kw of req.keywords) {
      const spec = this.specs.get(normalizeText(kw));
      if (spec?.kind === 'metrics' && spec.closeVariants) {
        for (const v of spec.closeVariants) {
          variantKeys.add(normalizeText(v));
        }
      }
    }
    const results: KeywordHistoricalResult[] = [];
    for (const kw of req.keywords) {
      const nt = normalizeText(kw);
      if (variantKeys.has(nt)) {
        continue; // 被某 canonical 涵蓋 → 不另回列
      }
      const spec = this.specs.get(nt);
      if (!spec || spec.kind !== 'metrics') {
        continue; // 略過 → 上游無此字 → fetchHistoricalMetrics 補無指標列
      }
      results.push({ text: kw, close_variants: spec.closeVariants, keyword_metrics: toRaw(spec) });
    }
    return Promise.resolve(results);
  }
}

const metrics = (over: Partial<Extract<MetricSpec, { kind: 'metrics' }>> = {}): MetricSpec => ({
  kind: 'metrics',
  avg: 100,
  competition: 'MEDIUM',
  competitionIndex: 40,
  lowMicros: '500000',
  highMicros: '1500000',
  months: [
    { year: 2025, month: 'JANUARY', searches: 90 },
    { year: 2025, month: 'FEBRUARY', searches: 110 },
  ],
  ...over,
});

const T0 = new Date('2026-02-01T00:00:00.000Z');
const T1 = new Date('2026-02-02T00:00:00.000Z');

describe('TC-65: VolumeRefreshService.refreshList (integration · Testcontainers · FR-29/NFR-16)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    jest.restoreAllMocks(); // 還原 per-member fault-injection spy（M11-R2）
    await prisma.volumeSnapshot.deleteMany();
    await prisma.trackingList.deleteMany(); // cascade removes members
  });

  interface Setup {
    fake: FakeAdsClient;
    svc: VolumeRefreshService;
    scheduleCids: string[];
  }

  const setup = (backfillMonths = 12): Setup => {
    const fake = new FakeAdsClient();
    const scheduleCids: string[] = [];
    const throttle: AdsThrottle = {
      schedule: async (cid, fn) => {
        scheduleCids.push(cid);
        return fn();
      },
    };
    const ads = new GoogleAdsService(fake, undefined, throttle);
    const svc = new VolumeRefreshService(prisma, ads, {
      maxLists: 50,
      maxMembersPerList: 500,
      maxItemsPerRequest: 500,
      backfillMonths,
      refreshCron: '0 3 * * *',
      keepSeriesOnDelete: false,
    });
    svc.now = () => T0;
    return { fake, svc, scheduleCids };
  };

  /** 建清單（TW/zh-TW）+ 成員（text/normalizedText），回 listId。 */
  async function seedList(members: { text: string; normalizedText: string }[]): Promise<string> {
    const list = await prisma.trackingList.create({
      data: { ownerId: randomUUID(), name: `list-${randomUUID()}`, geo: 'TW', language: 'zh-TW' },
    });
    for (const m of members) {
      await prisma.trackingListMember.create({
        data: { listId: list.id, normalizedText: m.normalizedText, text: m.text },
      });
    }
    return list.id;
  }

  const snapsOf = (listId: string, normalizedText: string) =>
    prisma.volumeSnapshot.findMany({
      where: { listId, normalizedText },
      orderBy: { fetchedAt: 'asc' },
    });

  const memberOf = (listId: string, normalizedText: string) =>
    prisma.trackingListMember.findUnique({
      where: { listId_normalizedText: { listId, normalizedText } },
    });

  describe('first fetch (AC-29.1/29.3/29.4)', () => {
    it('appends one snapshot per member; exact-only; null≠0; MonthOfYear by name; via throttle', async () => {
      const { fake, svc, scheduleCids } = setup();
      fake.specs.set('coffee', metrics());
      fake.specs.set('tea', { kind: 'omit' }); // 無資料 → all-null 列（斷點語意，非缺列）
      const listId = await seedList([
        { text: 'Coffee', normalizedText: 'coffee' },
        { text: 'Tea', normalizedText: 'tea' },
      ]);

      const res = await svc.refreshList(listId);

      expect(res).toEqual({
        listId,
        fetchedAt: T0,
        memberCount: 2,
        appended: 2,
        unchanged: 0,
        failed: 0,
      });
      // exact 模式：絕不走拓展端點；每批 ≤20；每次 Ads 呼叫都經節流器。
      expect(fake.ideasCalls).toBe(0);
      expect(fake.histCalls.every((c) => c.length <= 20)).toBe(true);
      expect(scheduleCids.length).toBe(fake.histCalls.length);
      expect(scheduleCids.length).toBeGreaterThan(0);

      const [coffee] = await snapsOf(listId, 'coffee');
      expect(coffee.avgMonthlySearches).toBe(100n); // BIGINT column (#469)
      expect(coffee.competition).toBe('MEDIUM');
      expect(coffee.competitionIndex).toBe(40);
      expect(coffee.cpcLowMicros).toBe(500000n);
      expect(coffee.cpcHighMicros).toBe(1500000n);
      expect(coffee.geo).toBe('TW');
      expect(coffee.language).toBe('zh-TW');
      expect(coffee.fetchedAt).toEqual(T0);
      expect(coffee.monthlyVolumes).toEqual([
        { year: 2025, month: 1, searches: 90 }, // JANUARY → 1（名稱映射，非 proto 整數）
        { year: 2025, month: 2, searches: 110 },
      ]);

      const [tea] = await snapsOf(listId, 'tea');
      expect(tea.avgMonthlySearches).toBeNull(); // null 不補 0
      expect(tea.cpcLowMicros).toBeNull();
      expect(tea.cpcHighMicros).toBeNull();
      expect(tea.competition).toBe('UNSPECIFIED');
      expect(tea.monthlyVolumes).toEqual([]);

      expect((await memberOf(listId, 'coffee'))?.lastCheckedAt).toEqual(T0);
      expect((await memberOf(listId, 'tea'))?.lastCheckedAt).toEqual(T0);
    });
  });

  describe('store-on-change dedup (AC-29.4 / S3)', () => {
    it('unchanged value → skip insert, only advance lastCheckedAt (no redundant row)', async () => {
      const { fake, svc } = setup();
      fake.specs.set('coffee', metrics());
      const listId = await seedList([{ text: 'Coffee', normalizedText: 'coffee' }]);

      const first = await svc.refreshList(listId);
      expect(first.appended).toBe(1);

      svc.now = () => T1; // 第二次刷新（同值）
      const second = await svc.refreshList(listId);
      expect(second).toMatchObject({ appended: 0, unchanged: 1, failed: 0 });

      const snaps = await snapsOf(listId, 'coffee');
      expect(snaps).toHaveLength(1); // 不冗餘落列
      expect((await memberOf(listId, 'coffee'))?.lastCheckedAt).toEqual(T1); // lastCheckedAt 仍前進
    });

    it('no-data member refreshed twice → second unchanged (all-null read back, null micros preserved)', async () => {
      const { fake, svc } = setup();
      fake.specs.set('ghost', { kind: 'omit' }); // 上游無資料 → all-null 快照（micros=null）
      const listId = await seedList([{ text: 'Ghost', normalizedText: 'ghost' }]);

      const first = await svc.refreshList(listId);
      expect(first).toMatchObject({ appended: 1, unchanged: 0, failed: 0 });

      svc.now = () => T1;
      const second = await svc.refreshList(listId); // 比對讀回 null micros 前一列 → 同值略過
      expect(second).toMatchObject({ appended: 0, unchanged: 1, failed: 0 });
      expect(await snapsOf(listId, 'ghost')).toHaveLength(1);
    });

    it('changed value → append new snapshot (append-only; prior row preserved)', async () => {
      const { fake, svc } = setup();
      fake.specs.set('coffee', metrics({ avg: 100 }));
      const listId = await seedList([{ text: 'Coffee', normalizedText: 'coffee' }]);

      await svc.refreshList(listId); // T0: avg 100
      fake.specs.set('coffee', metrics({ avg: 120 }));
      svc.now = () => T1;
      const second = await svc.refreshList(listId);
      expect(second).toMatchObject({ appended: 1, unchanged: 0 });

      const snaps = await snapsOf(listId, 'coffee');
      expect(snaps.map((s) => s.avgMonthlySearches)).toEqual([100n, 120n]); // BIGINT (#469)
      expect(snaps.map((s) => s.fetchedAt)).toEqual([T0, T1]); // 舊列不變、時序 append-only
    });
  });

  describe('partial resilience (AC-29.5)', () => {
    it('a failing batch does not abort the refresh; failed member gets no row + lastCheckedAt not advanced', async () => {
      const { fake, svc } = setup();
      svc.maxSeedsPerBatch = 1; // 每成員自成一批 → 隔離 per-batch 失敗
      fake.specs.set('coffee', metrics());
      fake.specs.set('tea', metrics({ avg: 5 }));
      fake.specs.set('boom', { kind: 'throw' });
      const listId = await seedList([
        { text: 'Coffee', normalizedText: 'coffee' },
        { text: 'Tea', normalizedText: 'tea' },
        { text: 'Boom', normalizedText: 'boom' },
      ]);

      const res = await svc.refreshList(listId); // 不整批失敗
      expect(res).toEqual({
        listId,
        fetchedAt: T0,
        memberCount: 3,
        appended: 2,
        unchanged: 0,
        failed: 1,
      });

      expect(await snapsOf(listId, 'coffee')).toHaveLength(1);
      expect(await snapsOf(listId, 'tea')).toHaveLength(1);
      expect(await snapsOf(listId, 'boom')).toHaveLength(0); // 斷點：該 fetchedAt 無資料列
      expect((await memberOf(listId, 'coffee'))?.lastCheckedAt).toEqual(T0);
      expect((await memberOf(listId, 'boom'))?.lastCheckedAt).toBeNull(); // 失敗 → 不前進
      expect(fake.ideasCalls).toBe(0);
    });
  });

  describe('close-variant aggregation (S4 · member key = normalizedText)', () => {
    it('one aggregated row attributes to every covered member (car/cars → both get the snapshot)', async () => {
      const { fake, svc } = setup();
      fake.specs.set('car', metrics({ avg: 5000, closeVariants: ['cars'] }));
      const listId = await seedList([
        { text: 'car', normalizedText: 'car' },
        { text: 'cars', normalizedText: 'cars' },
      ]);

      const res = await svc.refreshList(listId);
      expect(res).toMatchObject({ memberCount: 2, appended: 2, unchanged: 0, failed: 0 });
      expect((await snapsOf(listId, 'car'))[0].avgMonthlySearches).toBe(5000n); // BIGINT (#469)
      expect((await snapsOf(listId, 'cars'))[0].avgMonthlySearches).toBe(5000n); // 同觀測
    });
  });

  describe('backfill window (AC-29.1)', () => {
    it('trims stored monthlyVolumes to the most recent TRACKING_BACKFILL_MONTHS', async () => {
      const { fake, svc } = setup(2); // backfillMonths=2
      fake.specs.set(
        'coffee',
        metrics({
          months: [
            { year: 2024, month: 'NOVEMBER', searches: 10 },
            { year: 2024, month: 'DECEMBER', searches: 20 },
            { year: 2025, month: 'JANUARY', searches: 30 },
          ],
        }),
      );
      const listId = await seedList([{ text: 'Coffee', normalizedText: 'coffee' }]);

      await svc.refreshList(listId);
      const [coffee] = await snapsOf(listId, 'coffee');
      expect(coffee.monthlyVolumes).toEqual([
        { year: 2024, month: 12, searches: 20 },
        { year: 2025, month: 1, searches: 30 },
      ]);
    });
  });

  describe('default clock (production seam)', () => {
    it('unoverridden now → fetchedAt is the real current Date (real DI path)', async () => {
      // 不經 setup()（其覆寫 now=()=>T0）；直接建構以行使**預設 real clock**（`() => new Date()`）——
      // 即 production DI 建構路徑。以容忍下界斷言（real clock，不假決定性；test-authoring §5）。
      const fake = new FakeAdsClient();
      fake.specs.set('coffee', metrics());
      const throttle: AdsThrottle = { schedule: async (_cid, fn) => fn() };
      const ads = new GoogleAdsService(fake, undefined, throttle);
      const svc = new VolumeRefreshService(prisma, ads, {
        maxLists: 50,
        maxMembersPerList: 500,
        maxItemsPerRequest: 500,
        backfillMonths: 12,
        refreshCron: '0 3 * * *',
        keepSeriesOnDelete: false,
      });
      const before = Date.now();
      const listId = await seedList([{ text: 'Coffee', normalizedText: 'coffee' }]);
      const res = await svc.refreshList(listId);

      expect(res).toMatchObject({ memberCount: 1, appended: 1, unchanged: 0, failed: 0 });
      expect(res.fetchedAt).toBeInstanceOf(Date);
      expect(res.fetchedAt.getTime()).toBeGreaterThanOrEqual(before);
      const [coffee] = await snapsOf(listId, 'coffee');
      expect(coffee.fetchedAt).toEqual(res.fetchedAt); // 快照時間軸 = 觀測時點（real clock）
    });
  });

  describe('per-member resilience (AC-29.5 · M11-R2)', () => {
    it('單成員 DB 錯誤 → 只記 failed、同批其餘成員照常刷新（不逸出中止整清單）', async () => {
      const { fake, svc } = setup();
      fake.specs.set('boom', metrics({ avg: 5 })); // 依 normalizedText asc 先於 coffee 處理
      fake.specs.set('coffee', metrics());
      const listId = await seedList([
        { text: 'Boom', normalizedText: 'boom' },
        { text: 'Coffee', normalizedText: 'coffee' },
      ]);
      // 注入 per-member DB 故障：'boom' 的 volumeSnapshot.create 失敗（模擬並發移除 P2025 / 寫入錯誤）。
      const realCreate = prisma.volumeSnapshot.create.bind(prisma.volumeSnapshot);
      // Prisma `create` 為高度多載泛型，mock impl 無法精確對型 → 經 unknown 雙轉（非 as any）。
      const faultyCreate = (args: Prisma.VolumeSnapshotCreateArgs) =>
        (args.data as { normalizedText?: string }).normalizedText === 'boom'
          ? Promise.reject(new Error('simulated per-member DB error'))
          : realCreate(args);
      jest
        .spyOn(prisma.volumeSnapshot, 'create')
        .mockImplementation(faultyCreate as unknown as typeof prisma.volumeSnapshot.create);

      // 現況（RED）：boom 失敗逸出 refreshList → reject；修後（GREEN）：per-member catch → 續跑 coffee。
      const res = await svc.refreshList(listId);
      expect(res).toMatchObject({ memberCount: 2, appended: 1, unchanged: 0, failed: 1 });
      expect(await snapsOf(listId, 'coffee')).toHaveLength(1); // 他成員照常
      expect(await snapsOf(listId, 'boom')).toHaveLength(0); // 失敗成員無列（斷點）
    });
  });

  describe('edge cases', () => {
    it('unknown listId → NotFoundException', async () => {
      const { svc } = setup();
      await expect(svc.refreshList(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('list with no members → no Ads call, all-zero summary', async () => {
      const { fake, svc } = setup();
      const listId = await seedList([]);
      const res = await svc.refreshList(listId);
      expect(res).toEqual({
        listId,
        fetchedAt: T0,
        memberCount: 0,
        appended: 0,
        unchanged: 0,
        failed: 0,
      });
      expect(fake.histCalls).toHaveLength(0);
      expect(fake.ideasCalls).toBe(0);
    });
  });
});
