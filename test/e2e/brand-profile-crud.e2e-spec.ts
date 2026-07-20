import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { SessionService } from 'src/auth';
import { configureApp } from 'src/bootstrap';
import { CustomClassifyAssignProcessor } from 'src/custom-classify/custom-classify-assign.processor';
import { JourneyProcessor } from 'src/journey/journey.processor';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { PrismaService } from 'src/prisma';
import {
  CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION,
  CUSTOM_CLASSIFY_QUEUE_EVENTS,
} from 'src/queue/custom-classify-job-events.constants';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import {
  JOURNEY_JOB_EVENTS_CONNECTION,
  JOURNEY_QUEUE_EVENTS,
} from 'src/queue/journey-job-events.constants';
import { BULL_CONNECTION } from 'src/queue/queue.constants';
import {
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from 'src/queue/topic-job-events.constants';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';

/**
 * TC-76（FR-40，AC-40.1 · FR-27 owner scope）：BrandProfile CRUD 的 HTTP 端到端。
 * - create：ownerId=actor；缺 brand/brand.name→400；同 owner 重名→409（P2002→ConflictException）；不同 owner
 *   同名→201；回傳 `{ id, brand:{name,aliases,sites}, competitors, createdAt }`（不外洩 ownerId）。
 * - list：`ownerWhere(actor)` 過濾——session 見自己+共享(null)、apiKey 見全部；`?ownerId=` 無法拓寬（AC-27.4）。
 * - get/update/delete：非 owner / 不存在 → **同一 404**（不洩漏存在性）；rename 重名→409；delete→200。
 *
 * DB 以「忠實 Prisma 替身」（e2e project 無 Testcontainers；同 tracking-list-crud.e2e 先例）——`@@unique([ownerId,
 * name])` 由替身以真實 `P2002` 重現。**真實 Postgres 語意**（真 P2002 / JSONB round-trip）由
 * `test/integration/brand-profile-crud.int-spec.ts` 直打 service 覆蓋，兩者互為靠山、防替身漂移。
 */

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const API_KEY = 'test-api-key';
const ORIGIN = 'http://localhost:5173'; // .env.test ALLOWED_ORIGINS（session 狀態變更 CSRF 白名單）

interface ProfileRow {
  id: string;
  ownerId: string | null;
  name: string;
  aliases: Prisma.JsonValue;
  sites: Prisma.JsonValue;
  competitors: Prisma.JsonValue;
  createdAt: Date;
}
interface UserRow {
  id: string;
  email: string;
}

/** Prisma unique-constraint 違反（P2002），與真實 client 同型別（service 的 `instanceof` 判定得以觸發）。 */
function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

/**
 * 忠實 `prisma` 替身：`brandProfile`（+ `@@unique([ownerId,name])`）與 `user`（SessionAuthResolver 投影 {id,email}）。
 * ownerId=null（機器）名稱不受 unique 約束（Postgres NULLs distinct）——與 schema `@@unique([ownerId,name])` 一致。
 */
function makeFakeDb(users: UserRow[]) {
  const rows = new Map<string, ProfileRow>();
  const userMap = new Map(users.map((u) => [u.id, u]));
  let nextCreateError: Error | null = null;
  let nextUpdateError: Error | null = null;

  const dupName = (ownerId: string | null, name: string, exceptId?: string): boolean =>
    ownerId !== null &&
    [...rows.values()].some((r) => r.id !== exceptId && r.ownerId === ownerId && r.name === name);

  const matchesOwnerWhere = (
    row: ProfileRow,
    where: { OR?: Array<{ ownerId: string | null }> } | undefined,
  ): boolean => {
    if (!where?.OR) {
      return true; // apiKey → {}（不過濾）
    }
    return where.OR.some((c) => c.ownerId === row.ownerId);
  };

  return {
    reset(): void {
      rows.clear();
      nextCreateError = null;
      nextUpdateError = null;
    },
    failNextCreate(error: Error): void {
      nextCreateError = error;
    },
    failNextUpdate(error: Error): void {
      nextUpdateError = error;
    },
    seed(ownerId: string | null, name: string): void {
      const id = randomUUID();
      rows.set(id, {
        id,
        ownerId,
        name,
        aliases: [],
        sites: [],
        competitors: [],
        createdAt: new Date(),
      });
    },
    user: {
      findUnique: ({ where }: { where: { id?: string } }): Promise<UserRow | null> =>
        Promise.resolve(where.id ? (userMap.get(where.id) ?? null) : null),
    },
    brandProfile: {
      create: ({
        data,
      }: {
        data: {
          ownerId: string | null;
          name: string;
          aliases: Prisma.JsonValue;
          sites: Prisma.JsonValue;
          competitors: Prisma.JsonValue;
        };
      }): Promise<ProfileRow> => {
        if (nextCreateError) {
          const err = nextCreateError;
          nextCreateError = null;
          return Promise.reject(err);
        }
        if (dupName(data.ownerId, data.name)) {
          return Promise.reject(p2002(['owner_id', 'name']));
        }
        const row: ProfileRow = {
          id: randomUUID(),
          ownerId: data.ownerId,
          name: data.name,
          aliases: data.aliases,
          sites: data.sites,
          competitors: data.competitors,
          createdAt: new Date(),
        };
        rows.set(row.id, row);
        return Promise.resolve({ ...row });
      },
      findMany: ({
        where,
      }: {
        where?: { OR?: Array<{ ownerId: string | null }> };
        orderBy?: unknown;
      }): Promise<ProfileRow[]> => {
        const out = [...rows.values()]
          .filter((r) => matchesOwnerWhere(r, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((r) => ({ ...r }));
        return Promise.resolve(out);
      },
      findUnique: ({
        where,
        select,
      }: {
        where: { id: string };
        select?: { id?: boolean; ownerId?: boolean };
      }): Promise<ProfileRow | Pick<ProfileRow, 'id' | 'ownerId'> | null> => {
        const row = rows.get(where.id);
        if (!row) {
          return Promise.resolve(null);
        }
        if (select) {
          return Promise.resolve({ id: row.id, ownerId: row.ownerId });
        }
        return Promise.resolve({ ...row });
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: {
          name?: string;
          aliases?: Prisma.JsonValue;
          sites?: Prisma.JsonValue;
          competitors?: Prisma.JsonValue;
        };
      }): Promise<ProfileRow> => {
        if (nextUpdateError) {
          const err = nextUpdateError;
          nextUpdateError = null;
          return Promise.reject(err);
        }
        const row = rows.get(where.id);
        if (!row) {
          return Promise.reject(p2002(['id'])); // service 已先 assertOwnedRow，此路徑不預期
        }
        if (data.name !== undefined && dupName(row.ownerId, data.name, row.id)) {
          return Promise.reject(p2002(['owner_id', 'name']));
        }
        if (data.name !== undefined) {
          row.name = data.name;
        }
        if (data.aliases !== undefined) {
          row.aliases = data.aliases;
        }
        if (data.sites !== undefined) {
          row.sites = data.sites;
        }
        if (data.competitors !== undefined) {
          row.competitors = data.competitors;
        }
        return Promise.resolve({ ...row });
      },
      delete: ({ where }: { where: { id: string } }): Promise<ProfileRow | null> => {
        const row = rows.get(where.id) ?? null;
        rows.delete(where.id);
        return Promise.resolve(row ? { ...row } : null);
      },
    },
  };
}

interface Entry {
  name: string;
  aliases: string[];
  sites: string[];
}
interface ProfileView {
  id: string;
  brand: Entry;
  competitors: Entry[];
  createdAt: string;
}

describe('BrandProfile CRUD (e2e · TC-76 · FR-40/27)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof makeFakeDb>;
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    db = makeFakeDb([
      { id: OWNER_A, email: 'a@example.com' },
      { id: OWNER_B, email: 'b@example.com' },
    ]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BULL_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(TOPIC_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(TOPIC_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(KeywordAnalysisProcessor)
      .useValue({})
      .overrideProvider(JOURNEY_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOURNEY_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(JourneyProcessor)
      .useValue({})
      .overrideProvider(CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(CUSTOM_CLASSIFY_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(CustomClassifyAssignProcessor)
      .useValue({})
      .overrideProvider(TopicClusterProcessor)
      .useValue({})
      .overrideProvider(TrackingRefreshProcessor)
      .useValue({})
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const sessions = app.get(SessionService);
    cookieA = `sid=${await sessions.create(OWNER_A)}`;
    cookieB = `sid=${await sessions.create(OWNER_B)}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    db.reset();
  });

  const server = (): App => app.getHttpServer();
  const base = '/api/v1/brand-profiles';

  /** session actor 建立（帶 cookie + 同源 Origin，過 CSRF）。 */
  const createAs = (cookie: string, body: Record<string, unknown>) =>
    request(server()).post(base).set('Cookie', cookie).set('Origin', ORIGIN).send(body);

  const validBody = {
    brand: { name: 'ASUS', aliases: ['華碩'], sites: ['asus.com'] },
    competitors: [{ name: 'Acer', aliases: ['宏碁'], sites: ['acer.com'] }],
  };

  describe('auth boundary', () => {
    it('未認證（無 cookie / 無 x-api-key）→ 401', async () => {
      expect((await request(server()).get(base)).status).toBe(401);
    });
  });

  describe('POST /brand-profiles (AC-40.1)', () => {
    it('session 建立 → 201 + 回傳 { brand, competitors }（ownerId 不外洩）', async () => {
      const res = await createAs(cookieA, validBody);
      expect(res.status).toBe(201);
      const body = res.body as ProfileView;
      expect(body.brand).toEqual({ name: 'ASUS', aliases: ['華碩'], sites: ['asus.com'] });
      expect(body.competitors).toEqual([{ name: 'Acer', aliases: ['宏碁'], sites: ['acer.com'] }]);
      expect(typeof body.id).toBe('string');
      expect(typeof body.createdAt).toBe('string');
      expect(JSON.stringify(body).toLowerCase()).not.toContain('ownerid'); // owner 不外洩
    });

    it('僅 brand.name（aliases/sites/competitors 省略）→ 201 + 預設空陣列', async () => {
      const res = await createAs(cookieA, { brand: { name: 'SoloBrand' } });
      expect(res.status).toBe(201);
      const body = res.body as ProfileView;
      expect(body.brand).toEqual({ name: 'SoloBrand', aliases: [], sites: [] });
      expect(body.competitors).toEqual([]);
    });

    it('缺 brand → 400', async () => {
      expect((await createAs(cookieA, { competitors: [] })).status).toBe(400);
    });

    it('缺 brand.name → 400', async () => {
      expect((await createAs(cookieA, { brand: { aliases: ['x'] } })).status).toBe(400);
    });

    it('brand.name 空字串 → 400（@IsNotEmpty）', async () => {
      expect((await createAs(cookieA, { brand: { name: '' } })).status).toBe(400);
    });

    it('未宣告欄位（forbidNonWhitelisted）→ 400', async () => {
      expect((await createAs(cookieA, { ...validBody, ownerId: OWNER_B })).status).toBe(400);
    });

    it('competitor 缺 name → 400（巢狀驗證）', async () => {
      const res = await createAs(cookieA, {
        brand: { name: 'ASUS' },
        competitors: [{ aliases: ['x'] }],
      });
      expect(res.status).toBe(400);
    });

    it('同 owner 重名 → 409（P2002 → ConflictException）', async () => {
      expect((await createAs(cookieA, validBody)).status).toBe(201);
      expect((await createAs(cookieA, validBody)).status).toBe(409);
    });

    it('不同 owner 同名 → 各自 201（名稱只在 owner 內唯一）', async () => {
      expect((await createAs(cookieA, { brand: { name: 'shared' } })).status).toBe(201);
      expect((await createAs(cookieB, { brand: { name: 'shared' } })).status).toBe(201);
    });

    it('非 P2002 的 DB 錯誤 → 不吞、原樣上拋（500，非 409）', async () => {
      db.failNextCreate(new Error('connection reset'));
      expect((await createAs(cookieA, validBody)).status).toBe(500);
    });

    it('apiKey（機器）建立 → 201（ownerId=null，免 CSRF）', async () => {
      const res = await request(server())
        .post(base)
        .set('x-api-key', API_KEY)
        .send({ brand: { name: 'machine brand' } });
      expect(res.status).toBe(201);
    });
  });

  describe('GET /brand-profiles (AC-40.1 · owner scope)', () => {
    it('session 只見自己 + 共享(null)、不見他人', async () => {
      await createAs(cookieA, { brand: { name: 'A own' } });
      await request(server())
        .post(base)
        .set('x-api-key', API_KEY)
        .send({ brand: { name: 'shared null' } }); // ownerId=null（共享）
      const bOwn = (await createAs(cookieB, { brand: { name: 'B own' } })).body as ProfileView;

      const res = await request(server()).get(base).set('Cookie', cookieA);
      expect(res.status).toBe(200);
      const names = (res.body as ProfileView[]).map((r) => r.brand.name);
      expect(names).toContain('A own');
      expect(names).toContain('shared null'); // null-owner 共享可見
      expect(names).not.toContain('B own'); // 他人不可見
      expect((res.body as ProfileView[]).map((r) => r.id)).not.toContain(bOwn.id);
    });

    it('apiKey（機器）見全部（不套 owner 過濾）', async () => {
      await createAs(cookieA, { brand: { name: 'A own' } });
      await createAs(cookieB, { brand: { name: 'B own' } });
      const res = await request(server()).get(base).set('x-api-key', API_KEY);
      expect(res.status).toBe(200);
      const names = (res.body as ProfileView[]).map((r) => r.brand.name);
      expect(names).toEqual(expect.arrayContaining(['A own', 'B own']));
    });

    it('`?ownerId=B` 無法拓寬 scope（owner 僅源自 actor，AC-27.4）', async () => {
      await createAs(cookieA, { brand: { name: 'A own' } });
      const bOwn = (await createAs(cookieB, { brand: { name: 'B own' } })).body as ProfileView;
      const res = await request(server()).get(`${base}?ownerId=${OWNER_B}`).set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect((res.body as ProfileView[]).map((r) => r.id)).not.toContain(bOwn.id);
    });
  });

  describe('GET /brand-profiles/:id (AC-40.1 · cross-owner → 404)', () => {
    it('owner 讀自己 → brand + competitors', async () => {
      const a = (await createAs(cookieA, validBody)).body as ProfileView;
      const res = await request(server()).get(`${base}/${a.id}`).set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect((res.body as ProfileView).brand.name).toBe('ASUS');
    });

    it('非 owner 讀他人 → 404（不洩漏存在性）', async () => {
      const a = (await createAs(cookieA, validBody)).body as ProfileView;
      expect((await request(server()).get(`${base}/${a.id}`).set('Cookie', cookieB)).status).toBe(
        404,
      );
    });

    it('不存在的 id → 404', async () => {
      expect(
        (await request(server()).get(`${base}/${randomUUID()}`).set('Cookie', cookieA)).status,
      ).toBe(404);
    });

    it('malformed (non-UUID) id → 400 (ParseUUIDPipe)', async () => {
      expect(
        (await request(server()).get(`${base}/not-a-uuid`).set('Cookie', cookieA)).status,
      ).toBe(400);
    });
  });

  describe('PATCH /brand-profiles/:id (AC-40.1)', () => {
    const patch = (cookie: string, id: string, body: Record<string, unknown>) =>
      request(server())
        .patch(`${base}/${id}`)
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .send(body);

    it('owner 改名 → 200 + 新名（不清掉 aliases/sites）', async () => {
      const a = (await createAs(cookieA, validBody)).body as ProfileView;
      const res = await patch(cookieA, a.id, { name: 'ASUS ROG' });
      expect(res.status).toBe(200);
      const body = res.body as ProfileView;
      expect(body.brand.name).toBe('ASUS ROG');
      expect(body.brand.aliases).toEqual(['華碩']); // partial：aliases 未帶 → 保留
    });

    it('owner 只改 aliases（partial）→ 200 + 名稱不變', async () => {
      const a = (await createAs(cookieA, validBody)).body as ProfileView;
      const res = await patch(cookieA, a.id, { aliases: ['華碩', 'Asustek'] });
      expect(res.status).toBe(200);
      const body = res.body as ProfileView;
      expect(body.brand.name).toBe('ASUS');
      expect(body.brand.aliases).toEqual(['華碩', 'Asustek']);
    });

    it('owner 改 sites + competitors（整組取代）→ 200', async () => {
      const a = (await createAs(cookieA, validBody)).body as ProfileView;
      const res = await patch(cookieA, a.id, {
        sites: ['rog.asus.com'],
        competitors: [{ name: 'Dell', aliases: [], sites: ['dell.com'] }],
      });
      expect(res.status).toBe(200);
      const body = res.body as ProfileView;
      expect(body.brand.sites).toEqual(['rog.asus.com']);
      expect(body.brand.name).toBe('ASUS'); // 名稱未帶 → 保留
      expect(body.competitors).toEqual([{ name: 'Dell', aliases: [], sites: ['dell.com'] }]);
    });

    it('非 owner 改名 → 404（且未改動）', async () => {
      const a = (await createAs(cookieA, validBody)).body as ProfileView;
      expect((await patch(cookieB, a.id, { name: 'hijacked' })).status).toBe(404);
      const check = (await request(server()).get(`${base}/${a.id}`).set('Cookie', cookieA))
        .body as ProfileView;
      expect(check.brand.name).toBe('ASUS'); // 未被改
    });

    it('改成同 owner 既有名 → 409', async () => {
      await createAs(cookieA, { brand: { name: 'first' } });
      const second = (await createAs(cookieA, { brand: { name: 'second' } })).body as ProfileView;
      expect((await patch(cookieA, second.id, { name: 'first' })).status).toBe(409);
    });

    it('非 P2002 的 DB 錯誤（改名）→ 不吞、原樣上拋（500，非 409）', async () => {
      const a = (await createAs(cookieA, validBody)).body as ProfileView;
      db.failNextUpdate(new Error('connection reset'));
      expect((await patch(cookieA, a.id, { name: 'x' })).status).toBe(500);
    });

    it('name 空字串 → 400', async () => {
      const a = (await createAs(cookieA, validBody)).body as ProfileView;
      expect((await patch(cookieA, a.id, { name: '' })).status).toBe(400);
    });

    it('不存在的 id → 404', async () => {
      expect((await patch(cookieA, randomUUID(), { name: 'x' })).status).toBe(404);
    });
  });

  describe('DELETE /brand-profiles/:id (AC-40.1)', () => {
    const del = (cookie: string, id: string) =>
      request(server()).delete(`${base}/${id}`).set('Cookie', cookie).set('Origin', ORIGIN);

    it('owner 刪除 → 200；後續 GET → 404', async () => {
      const a = (await createAs(cookieA, validBody)).body as ProfileView;
      const res = await del(cookieA, a.id);
      expect(res.status).toBe(200);
      expect((res.body as { id: string }).id).toBe(a.id);
      expect((await request(server()).get(`${base}/${a.id}`).set('Cookie', cookieA)).status).toBe(
        404,
      );
    });

    it('非 owner 刪除 → 404（且未刪除）', async () => {
      const a = (await createAs(cookieA, validBody)).body as ProfileView;
      expect((await del(cookieB, a.id)).status).toBe(404);
      expect((await request(server()).get(`${base}/${a.id}`).set('Cookie', cookieA)).status).toBe(
        200,
      ); // A 仍可讀 → 未被刪
    });

    it('不存在的 id → 404', async () => {
      expect((await del(cookieA, randomUUID())).status).toBe(404);
    });
  });
});
