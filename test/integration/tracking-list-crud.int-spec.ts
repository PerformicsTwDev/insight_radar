import { randomUUID } from 'node:crypto';
import { ConflictException, type INestApplication, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/authenticated-user';
import type { PrismaService } from 'src/prisma';
import { TopicRepository } from 'src/topics/topic.repository';
import { TrackingListService } from 'src/tracking/tracking-list.service';
import { createPrismaTestApp } from '../utils';

/**
 * TC-64（FR-28 / FR-27 · Testcontainers 真 Postgres）：TrackingList CRUD 的 **DB 層強制**——
 * 直接構造 `TrackingListService`（真 prisma），驗真實 Postgres 語意：`@@unique([ownerId,name])` → 真 P2002 →
 * `ConflictException`（409）；owner scope（session 見自己+共享(null)、apiKey 見全部；越權單列 → 404）；
 * `_count.members`；`onDelete: Cascade`（刪清單→成員一併移除）。owner 僅源自 actor（無 ownerId 參數可拓寬）。
 * HTTP 層（守衛/CSRF/驗證/狀態碼映射）由 `test/e2e/tracking-list-crud.e2e-spec.ts` 覆蓋，兩者互補。
 */

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const SESSION_A: AuthenticatedUser = { kind: 'session', id: OWNER_A, email: 'a@example.com' };
const SESSION_B: AuthenticatedUser = { kind: 'session', id: OWNER_B, email: 'b@example.com' };
const API_KEY: AuthenticatedUser = { kind: 'apiKey' };

const BODY = { name: 'Running shoes', geo: 'TW', language: 'zh-TW' };

describe('TrackingList CRUD (integration · Testcontainers · TC-64 · FR-28/27)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: TrackingListService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    // T11.3：service 建構子加入 TopicRepository（主題展開）+ trackingConfig（成員上限 + 加成員請求上限）。
    // CRUD（本檔）不觸及加成員路徑，兩上限任意；直接構造與 T11.2 慣例一致（HTTP 層由 e2e 覆蓋）。
    service = new TrackingListService(prisma, new TopicRepository(prisma), {
      maxMembersPerList: 500,
      maxItemsPerRequest: 500,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.trackingList.deleteMany(); // cascade removes members
  });

  /** 直接落一筆成員（T11.3 之前無 addMembers；供 detail / memberCount / cascade 測試）。 */
  const addMember = (listId: string, normalizedText: string, text: string) =>
    prisma.trackingListMember.create({ data: { listId, normalizedText, text } });

  describe('create (AC-28.1)', () => {
    it('session actor → ownerId = actor.id；回傳清單', async () => {
      const view = await service.create(BODY, SESSION_A);
      expect(view).toMatchObject({ name: 'Running shoes', geo: 'TW', language: 'zh-TW' });
      const row = await prisma.trackingList.findUnique({ where: { id: view.listId } });
      expect(row?.ownerId).toBe(OWNER_A);
    });

    it('apiKey（機器）actor → ownerId = null', async () => {
      const view = await service.create({ ...BODY, name: 'machine' }, API_KEY);
      const row = await prisma.trackingList.findUnique({ where: { id: view.listId } });
      expect(row?.ownerId).toBeNull();
    });

    it('同 owner 重名 → ConflictException（真 P2002）', async () => {
      await service.create({ ...BODY, name: 'dup' }, SESSION_A);
      await expect(service.create({ ...BODY, name: 'dup' }, SESSION_A)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('不同 owner 同名 → 各自成功（名稱僅在 owner 內唯一）', async () => {
      await service.create({ ...BODY, name: 'shared' }, SESSION_A);
      await expect(service.create({ ...BODY, name: 'shared' }, SESSION_B)).resolves.toMatchObject({
        name: 'shared',
      });
    });

    it('機器（null-owner）同名不受 unique 約束（Postgres NULLs distinct；業務規則，非 bug）', async () => {
      await service.create({ ...BODY, name: 'machine dup' }, API_KEY);
      await expect(
        service.create({ ...BODY, name: 'machine dup' }, API_KEY),
      ).resolves.toMatchObject({ name: 'machine dup' });
    });
  });

  describe('list (AC-28.3 · owner scope)', () => {
    it('session 見自己 + 共享(null)、不見他人；memberCount 由 _count', async () => {
      const own = await service.create({ ...BODY, name: 'A own' }, SESSION_A);
      await addMember(own.listId, 'running shoes', 'Running Shoes');
      await addMember(own.listId, 'trail shoes', 'Trail Shoes');
      const shared = await service.create({ ...BODY, name: 'shared null' }, API_KEY);
      const bOwn = await service.create({ ...BODY, name: 'B own' }, SESSION_B);

      const rows = await service.list(SESSION_A);
      const ids = rows.map((r) => r.listId);
      expect(ids).toContain(own.listId);
      expect(ids).toContain(shared.listId); // 共享（null-owner）
      expect(ids).not.toContain(bOwn.listId); // 他人不可見
      expect(rows.find((r) => r.listId === own.listId)?.memberCount).toBe(2);
      expect(rows.find((r) => r.listId === shared.listId)?.memberCount).toBe(0);
    });

    it('apiKey（機器）見全部（不套 owner 過濾）', async () => {
      const a = await service.create({ ...BODY, name: 'A own' }, SESSION_A);
      const b = await service.create({ ...BODY, name: 'B own' }, SESSION_B);
      const ids = (await service.list(API_KEY)).map((r) => r.listId);
      expect(ids).toEqual(expect.arrayContaining([a.listId, b.listId]));
    });
  });

  describe('getDetail (AC-28.3 · cross-owner → 404)', () => {
    it('owner 讀自己 → metadata + 成員基本面（normalizedText/text/addedAt/lastCheckedAt）', async () => {
      const own = await service.create(BODY, SESSION_A);
      await addMember(own.listId, 'running shoes', 'Running Shoes');
      const detail = await service.getDetail(own.listId, SESSION_A);
      expect(detail).toMatchObject({ listId: own.listId, name: 'Running shoes', geo: 'TW' });
      expect(detail.members).toHaveLength(1);
      expect(detail.members[0]).toMatchObject({
        normalizedText: 'running shoes',
        text: 'Running Shoes',
        lastCheckedAt: null,
      });
      expect(detail.members[0].addedAt).toBeInstanceOf(Date);
    });

    it('session 讀共享(null)清單 → 放行', async () => {
      const shared = await service.create({ ...BODY, name: 'shared' }, API_KEY);
      await expect(service.getDetail(shared.listId, SESSION_A)).resolves.toMatchObject({
        listId: shared.listId,
      });
    });

    it('非 owner 讀他人清單 → 404（NotFoundException，不洩漏存在性）', async () => {
      const own = await service.create(BODY, SESSION_A);
      await expect(service.getDetail(own.listId, SESSION_B)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('不存在的 listId → 404', async () => {
      await expect(service.getDetail(randomUUID(), SESSION_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('apiKey（機器）讀任意 owner → 放行', async () => {
      const own = await service.create(BODY, SESSION_A);
      await expect(service.getDetail(own.listId, API_KEY)).resolves.toMatchObject({
        listId: own.listId,
      });
    });
  });

  describe('rename (AC-28.2)', () => {
    it('owner 改名 → 新名落 DB', async () => {
      const own = await service.create(BODY, SESSION_A);
      const view = await service.rename(own.listId, { name: 'Trail shoes' }, SESSION_A);
      expect(view.name).toBe('Trail shoes');
      const row = await prisma.trackingList.findUnique({ where: { id: own.listId } });
      expect(row?.name).toBe('Trail shoes');
    });

    it('非 owner 改名 → 404 且未改動', async () => {
      const own = await service.create(BODY, SESSION_A);
      await expect(
        service.rename(own.listId, { name: 'hijacked' }, SESSION_B),
      ).rejects.toBeInstanceOf(NotFoundException);
      const row = await prisma.trackingList.findUnique({ where: { id: own.listId } });
      expect(row?.name).toBe('Running shoes'); // 未被改
    });

    it('改成同 owner 既有名 → ConflictException（真 P2002）', async () => {
      await service.create({ ...BODY, name: 'first' }, SESSION_A);
      const second = await service.create({ ...BODY, name: 'second' }, SESSION_A);
      await expect(
        service.rename(second.listId, { name: 'first' }, SESSION_A),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('不存在的 listId → 404', async () => {
      await expect(service.rename(randomUUID(), { name: 'x' }, SESSION_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove (AC-28.2 · cascade)', () => {
    it('owner 刪除 → 清單消失、成員一併 cascade 移除', async () => {
      const own = await service.create(BODY, SESSION_A);
      await addMember(own.listId, 'kw', 'kw');
      const out = await service.remove(own.listId, SESSION_A);
      expect(out.listId).toBe(own.listId);
      expect(await prisma.trackingList.findUnique({ where: { id: own.listId } })).toBeNull();
      expect(await prisma.trackingListMember.count({ where: { listId: own.listId } })).toBe(0);
    });

    it('非 owner 刪除 → 404 且未刪除', async () => {
      const own = await service.create(BODY, SESSION_A);
      await expect(service.remove(own.listId, SESSION_B)).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.trackingList.findUnique({ where: { id: own.listId } })).not.toBeNull();
    });

    it('不存在的 listId → 404', async () => {
      await expect(service.remove(randomUUID(), SESSION_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
