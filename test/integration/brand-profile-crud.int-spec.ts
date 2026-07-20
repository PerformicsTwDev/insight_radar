import { randomUUID } from 'node:crypto';
import { ConflictException, type INestApplication, NotFoundException } from '@nestjs/common';
import { BrandProfileService } from 'src/brand-profile/brand-profile.service';
import type { AuthenticatedUser } from 'src/common/authenticated-user';
import type { PrismaService } from 'src/prisma';
import { createPrismaTestApp } from '../utils';

/**
 * TC-76（FR-40 / FR-27 · Testcontainers 真 Postgres）：BrandProfile CRUD 的 **DB 層強制**——直接構造
 * `BrandProfileService`（真 prisma），驗真實 Postgres 語意：`@@unique([ownerId,name])` → 真 P2002 →
 * `ConflictException`（409）；owner scope（session 見自己+共享(null)、apiKey 見全部；越權單列 → 404）；
 * JSONB round-trip（aliases/sites/competitors）。owner 僅源自 actor（無 ownerId 參數可拓寬）。HTTP 層
 * （守衛/CSRF/驗證/狀態碼映射）由 `test/e2e/brand-profile-crud.e2e-spec.ts` 覆蓋，兩者互補、防替身漂移。
 */

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const SESSION_A: AuthenticatedUser = { kind: 'session', id: OWNER_A, email: 'a@example.com' };
const SESSION_B: AuthenticatedUser = { kind: 'session', id: OWNER_B, email: 'b@example.com' };
const API_KEY: AuthenticatedUser = { kind: 'apiKey' };

const BODY = {
  brand: { name: 'ASUS', aliases: ['華碩'], sites: ['asus.com'] },
  competitors: [{ name: 'Acer', aliases: ['宏碁'], sites: ['acer.com'] }],
};

describe('BrandProfile CRUD (integration · Testcontainers · TC-76 · FR-40/27)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: BrandProfileService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    service = new BrandProfileService(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.brandProfile.deleteMany();
  });

  describe('create (AC-40.1)', () => {
    it('session actor → ownerId = actor.id；JSONB round-trip', async () => {
      const view = await service.create(BODY, SESSION_A);
      expect(view.brand).toEqual({ name: 'ASUS', aliases: ['華碩'], sites: ['asus.com'] });
      expect(view.competitors).toEqual([{ name: 'Acer', aliases: ['宏碁'], sites: ['acer.com'] }]);
      const row = await prisma.brandProfile.findUnique({ where: { id: view.id } });
      expect(row?.ownerId).toBe(OWNER_A);
    });

    it('省略 aliases/sites/competitors → 落庫預設空陣列', async () => {
      const view = await service.create({ brand: { name: 'Solo' } }, SESSION_A);
      expect(view.brand).toEqual({ name: 'Solo', aliases: [], sites: [] });
      expect(view.competitors).toEqual([]);
    });

    it('apiKey（機器）actor → ownerId = null', async () => {
      const view = await service.create({ brand: { name: 'machine' } }, API_KEY);
      const row = await prisma.brandProfile.findUnique({ where: { id: view.id } });
      expect(row?.ownerId).toBeNull();
    });

    it('同 owner 重名 → ConflictException（真 P2002）', async () => {
      await service.create({ brand: { name: 'dup' } }, SESSION_A);
      await expect(service.create({ brand: { name: 'dup' } }, SESSION_A)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('不同 owner 同名 → 各自成功（名稱僅在 owner 內唯一）', async () => {
      await service.create({ brand: { name: 'shared' } }, SESSION_A);
      await expect(service.create({ brand: { name: 'shared' } }, SESSION_B)).resolves.toMatchObject(
        { brand: { name: 'shared' } },
      );
    });

    it('機器（null-owner）同名不受 unique 約束（Postgres NULLs distinct；業務規則，非 bug）', async () => {
      await service.create({ brand: { name: 'machine dup' } }, API_KEY);
      await expect(
        service.create({ brand: { name: 'machine dup' } }, API_KEY),
      ).resolves.toMatchObject({ brand: { name: 'machine dup' } });
    });
  });

  describe('list (AC-40.1 · owner scope)', () => {
    it('session 見自己 + 共享(null)、不見他人', async () => {
      const own = await service.create({ brand: { name: 'A own' } }, SESSION_A);
      const shared = await service.create({ brand: { name: 'shared null' } }, API_KEY);
      const bOwn = await service.create({ brand: { name: 'B own' } }, SESSION_B);

      const ids = (await service.list(SESSION_A)).map((r) => r.id);
      expect(ids).toContain(own.id);
      expect(ids).toContain(shared.id); // 共享（null-owner）
      expect(ids).not.toContain(bOwn.id); // 他人不可見
    });

    it('apiKey（機器）見全部（不套 owner 過濾）', async () => {
      const a = await service.create({ brand: { name: 'A own' } }, SESSION_A);
      const b = await service.create({ brand: { name: 'B own' } }, SESSION_B);
      const ids = (await service.list(API_KEY)).map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
    });
  });

  describe('get (AC-40.1 · cross-owner → 404)', () => {
    it('owner 讀自己 → brand + competitors', async () => {
      const own = await service.create(BODY, SESSION_A);
      const got = await service.get(own.id, SESSION_A);
      expect(got.brand.name).toBe('ASUS');
      expect(got.competitors).toHaveLength(1);
    });

    it('session 讀共享(null) → 放行', async () => {
      const shared = await service.create({ brand: { name: 'shared' } }, API_KEY);
      await expect(service.get(shared.id, SESSION_A)).resolves.toMatchObject({ id: shared.id });
    });

    it('非 owner 讀他人 → 404（NotFoundException，不洩漏存在性）', async () => {
      const own = await service.create(BODY, SESSION_A);
      await expect(service.get(own.id, SESSION_B)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('不存在的 id → 404', async () => {
      await expect(service.get(randomUUID(), SESSION_A)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('apiKey（機器）讀任意 owner → 放行', async () => {
      const own = await service.create(BODY, SESSION_A);
      await expect(service.get(own.id, API_KEY)).resolves.toMatchObject({ id: own.id });
    });
  });

  describe('update (AC-40.1)', () => {
    it('owner 改名（partial）→ 新名落 DB、aliases 保留', async () => {
      const own = await service.create(BODY, SESSION_A);
      const view = await service.update(own.id, { name: 'ASUS ROG' }, SESSION_A);
      expect(view.brand.name).toBe('ASUS ROG');
      expect(view.brand.aliases).toEqual(['華碩']);
      const row = await prisma.brandProfile.findUnique({ where: { id: own.id } });
      expect(row?.name).toBe('ASUS ROG');
    });

    it('owner 只改 competitors → 整組取代', async () => {
      const own = await service.create(BODY, SESSION_A);
      const view = await service.update(
        own.id,
        { competitors: [{ name: 'Dell', aliases: [], sites: [] }] },
        SESSION_A,
      );
      expect(view.competitors).toEqual([{ name: 'Dell', aliases: [], sites: [] }]);
    });

    it('非 owner 改名 → 404 且未改動', async () => {
      const own = await service.create(BODY, SESSION_A);
      await expect(service.update(own.id, { name: 'hijacked' }, SESSION_B)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const row = await prisma.brandProfile.findUnique({ where: { id: own.id } });
      expect(row?.name).toBe('ASUS'); // 未被改
    });

    it('改成同 owner 既有名 → ConflictException（真 P2002）', async () => {
      await service.create({ brand: { name: 'first' } }, SESSION_A);
      const second = await service.create({ brand: { name: 'second' } }, SESSION_A);
      await expect(service.update(second.id, { name: 'first' }, SESSION_A)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('不存在的 id → 404', async () => {
      await expect(service.update(randomUUID(), { name: 'x' }, SESSION_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('空 patch（no-op）→ 回現況', async () => {
      const own = await service.create(BODY, SESSION_A);
      const view = await service.update(own.id, {}, SESSION_A);
      expect(view.brand.name).toBe('ASUS');
    });
  });

  describe('remove (AC-40.1)', () => {
    it('owner 刪除 → 檔案消失', async () => {
      const own = await service.create(BODY, SESSION_A);
      const out = await service.remove(own.id, SESSION_A);
      expect(out.id).toBe(own.id);
      expect(await prisma.brandProfile.findUnique({ where: { id: own.id } })).toBeNull();
    });

    it('非 owner 刪除 → 404 且未刪除', async () => {
      const own = await service.create(BODY, SESSION_A);
      await expect(service.remove(own.id, SESSION_B)).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.brandProfile.findUnique({ where: { id: own.id } })).not.toBeNull();
    });

    it('不存在的 id → 404', async () => {
      await expect(service.remove(randomUUID(), SESSION_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
