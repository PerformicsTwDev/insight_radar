import { randomUUID } from 'node:crypto';
import { ConflictException, type INestApplication } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { trackingConfig } from 'src/config/tracking.config';
import type { AuthenticatedUser } from 'src/common/authenticated-user';
import type { PrismaService } from 'src/prisma';
import { SweepLeaseService, SWEEP_LEASE_NAME } from 'src/tracking/sweep-lease.service';
import { TopicRepository } from 'src/topics/topic.repository';
import { TrackingListService } from 'src/tracking/tracking-list.service';
import { createPrismaTestApp } from '../utils';

/**
 * TC-64/TC-65（#470 · M11 gate should · NFR-16 · Testcontainers 真 Postgres）：**並發守門硬化**的 DB 層強制。
 * 三處原 check-then-act 於並發下越界（bounded、非阻斷）——本檔以**真並發**（`Promise.all`/`allSettled` 對真 PG）
 * 重現競態並驗修正後不變式：
 * - create 上限（AC-28.7）：per-owner advisory lock → 同 owner 並發建立**永不越過** `TRACKING_MAX_LISTS`。
 * - addMembers 上限（AC-28.7）：per-list advisory lock → 同清單並發加成員**永不越過** `TRACKING_MAX_MEMBERS_PER_LIST`。
 * - addMembers 去重（AC-28.4）：`@@id` PK + skipDuplicates → 並發加同字**恆單一成員**（DB 保證，非本次新增但守回歸）。
 * - 排程 sweep single-flight（AC-29.2）：`tracking_sweep_leases` 租約 → 並發 acquire **恰一贏**；持有阻擋、
 *   釋放/過期可再搶（crash 復原）。
 *
 * 純序列語意由 tracking-list-crud / -members int-spec 覆蓋；本檔專攻**並發**維度，互補。
 */

const SESSION = (id: string): AuthenticatedUser => ({ kind: 'session', id, email: `${id}@x.test` });
const TW = { geo: 'TW', language: 'zh-TW' } as const;

const makeConfig = (
  over: Partial<ConfigType<typeof trackingConfig>> = {},
): ConfigType<typeof trackingConfig> => ({
  maxLists: 50,
  maxMembersPerList: 500,
  maxItemsPerRequest: 500,
  backfillMonths: 12,
  refreshCron: '0 3 * * *',
  keepSeriesOnDelete: false,
  sweepLeaseMs: 3_600_000,
  ...over,
});

describe('Tracking concurrency hardening (integration · Testcontainers · #470 · NFR-16)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM tracking_sweep_leases');
    await prisma.volumeSnapshot.deleteMany();
    await prisma.trackingList.deleteMany(); // cascade removes members
  });

  const makeService = (config = makeConfig()): TrackingListService =>
    new TrackingListService(prisma, new TopicRepository(prisma), config);

  describe('create list cap — TOCTOU (AC-28.7)', () => {
    it('concurrent creates for the same owner never exceed TRACKING_MAX_LISTS', async () => {
      const MAX = 3;
      const N = 12;
      const owner = randomUUID();
      const svc = makeService(makeConfig({ maxLists: MAX }));

      // 12 個並發建立（distinct name → 不觸 unique-name 路徑，隔離「上限」競態）。
      const results = await Promise.allSettled(
        Array.from({ length: N }, (_, i) =>
          svc.create({ ...TW, name: `list-${i}` }, SESSION(owner)),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      const dbCount = await prisma.trackingList.count({ where: { ownerId: owner } });

      // 硬不變式：DB 實際清單數 == MAX（不越界）；恰 MAX 成功、其餘皆 409（ConflictException）。
      expect(dbCount).toBe(MAX);
      expect(fulfilled).toHaveLength(MAX);
      expect(rejected).toHaveLength(N - MAX);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(ConflictException);
      }
    });

    it('the per-owner lock does not serialize across different owners (A full ≠ B blocked)', async () => {
      const svc = makeService(makeConfig({ maxLists: 1 }));
      const a = randomUUID();
      const b = randomUUID();

      const [ra, rb] = await Promise.allSettled([
        svc.create({ ...TW, name: 'a1' }, SESSION(a)),
        svc.create({ ...TW, name: 'b1' }, SESSION(b)),
      ]);

      expect(ra.status).toBe('fulfilled');
      expect(rb.status).toBe('fulfilled'); // 不同 owner → 不互擋
    });
  });

  describe('addMembers cap — TOCTOU (AC-28.7)', () => {
    it('concurrent addMembers to one list never exceed TRACKING_MAX_MEMBERS_PER_LIST', async () => {
      const MAX = 5;
      const N = 12;
      const svc = makeService(makeConfig({ maxMembersPerList: MAX }));
      const owner = randomUUID();
      const list = await svc.create({ ...TW, name: 'members-cap' }, SESSION(owner));

      // N 個並發加「各一個 distinct 關鍵字」→ 無鎖時皆讀 existing<MAX 各自落列 → 越界。
      const results = await Promise.allSettled(
        Array.from({ length: N }, (_, i) =>
          svc.addMembers(
            list.listId,
            { items: [{ kind: 'keyword', text: `kw-${i}`, ...TW }] },
            SESSION(owner),
          ),
        ),
      );

      const memberCount = await prisma.trackingListMember.count({ where: { listId: list.listId } });
      const rejected = results.filter((r) => r.status === 'rejected');

      // 硬不變式：DB 成員數 == MAX（不越界）；超限請求 409（ConflictException）。
      expect(memberCount).toBe(MAX);
      expect(rejected).toHaveLength(N - MAX);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(ConflictException);
      }
    });

    it('concurrent addMembers of the SAME keyword dedupes to a single member (AC-28.4, DB PK)', async () => {
      const svc = makeService(); // 上限寬鬆，隔離去重維度
      const owner = randomUUID();
      const list = await svc.create({ ...TW, name: 'dedupe' }, SESSION(owner));

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          svc.addMembers(
            list.listId,
            { items: [{ kind: 'keyword', text: 'Running Shoes', ...TW }] },
            SESSION(owner),
          ),
        ),
      );

      const memberCount = await prisma.trackingListMember.count({ where: { listId: list.listId } });
      const totalAdded = results.reduce((sum, r) => sum + r.added, 0);

      expect(memberCount).toBe(1); // 恆單一成員（去重 DB 保證）
      expect(totalAdded).toBe(1); // 僅一個並發實際落列，其餘 added=0（或 skipDuplicates 併吞）
    });
  });

  describe('scheduled sweep single-flight — DB lease (AC-29.2)', () => {
    const makeLease = (config = makeConfig()): SweepLeaseService =>
      new SweepLeaseService(prisma, config);

    it('two concurrent acquires → exactly one wins (single-flight)', async () => {
      const lease = makeLease();
      const [a, b] = await Promise.all([lease.acquire(), lease.acquire()]);
      expect([a, b].filter(Boolean)).toHaveLength(1); // 恰一贏
    });

    it('a held lease blocks a second acquire until released', async () => {
      const lease = makeLease();
      expect(await lease.acquire()).toBe(true); // 首搶
      expect(await lease.acquire()).toBe(false); // 持有中 → 擋
      await lease.release();
      expect(await lease.acquire()).toBe(true); // 釋放後可再搶
    });

    it('an expired lease can be re-acquired (crash recovery via TTL)', async () => {
      const lease = makeLease();
      expect(await lease.acquire()).toBe(true);
      // 模擬持有者崩潰未釋放：把租約強制設為過去（等同 TTL 已到期）。
      await prisma.$executeRawUnsafe(
        `UPDATE tracking_sweep_leases SET leased_until = now() - interval '1 hour' WHERE name = $1`,
        SWEEP_LEASE_NAME,
      );
      expect(await lease.acquire()).toBe(true); // 過期 → 下次可搶
    });
  });
});
