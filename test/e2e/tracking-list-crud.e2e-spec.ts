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
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { PrismaService } from 'src/prisma';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION } from 'src/queue/queue.constants';
import {
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from 'src/queue/topic-job-events.constants';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';

/**
 * TC-64（FR-28，AC-28.1/28.2/28.3 · FR-27 owner scope）：TrackingList CRUD 的 HTTP 端到端。
 * - create：ownerId=actor；缺 name/geo/language→400；同 owner 重名→409（P2002→ConflictException）；
 *   不同 owner 同名→201；建立回傳清單。
 * - list：`ownerWhere(actor)` 過濾——session 見自己+共享(null)、apiKey 見全部；每列帶 `memberCount`；
 *   `?ownerId=` 無法拓寬 scope（owner 僅源自 actor，AC-27.4）。
 * - detail/rename/delete：非 owner / 不存在 → **同一 404**（不洩漏存在性）；rename 重名→409；delete→200。
 *
 * DB 以「忠實 Prisma 替身」（e2e project 無 Testcontainers；同 auth-endpoints.e2e / history-list.e2e 先例）——
 * `@@unique([ownerId,name])` 由替身以真實 `P2002` 重現；cascade / `_count` 亦忠實模擬。**真實 Postgres 語意**
 * （真 P2002 / 真 cascade / 真 `_count`）由 `test/integration/tracking-list-crud.int-spec.ts` 直打 service 覆蓋，
 * 兩者互為靠山、防替身漂移。session 走真 `SessionService`（記憶體 Keyv，NODE_ENV=test）鑄 sid。
 */

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const API_KEY = 'test-api-key';
const ORIGIN = 'http://localhost:5173'; // .env.test ALLOWED_ORIGINS（session 狀態變更 CSRF 白名單）

interface ListRow {
  id: string;
  ownerId: string | null;
  name: string;
  geo: string;
  language: string;
  createdAt: Date;
}
interface MemberRow {
  listId: string;
  normalizedText: string;
  text: string;
  addedAt: Date;
  lastCheckedAt: Date | null;
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
 * 忠實 `prisma` 替身：`trackingList`（+ `@@unique([ownerId,name])`、cascade、`_count`）、`trackingListMember`
 * （seed 用）、`user`（SessionAuthResolver 投影 `{id,email}`）。ownerId=null（機器）名稱不受 unique 約束
 * （Postgres NULLs distinct）——與 schema `@@unique([ownerId,name])` 語意一致。
 */
function makeFakeTrackingDb(users: UserRow[]) {
  const lists = new Map<string, ListRow>();
  const members: MemberRow[] = [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  let nextCreateError: Error | null = null;
  let nextUpdateError: Error | null = null;

  const memberCount = (listId: string): number => members.filter((m) => m.listId === listId).length;

  const dupName = (ownerId: string | null, name: string, exceptId?: string): boolean =>
    ownerId !== null &&
    [...lists.values()].some((l) => l.id !== exceptId && l.ownerId === ownerId && l.name === name);

  const matchesOwnerWhere = (
    row: ListRow,
    where: { OR?: Array<{ ownerId: string | null }> } | undefined,
  ): boolean => {
    if (!where?.OR) {
      return true; // apiKey → {}（不過濾）
    }
    return where.OR.some((c) => c.ownerId === row.ownerId);
  };

  return {
    reset(): void {
      lists.clear();
      members.length = 0;
      nextCreateError = null;
      nextUpdateError = null;
    },
    failNextCreate(error: Error): void {
      nextCreateError = error;
    },
    failNextUpdate(error: Error): void {
      nextUpdateError = error;
    },
    seedMember(listId: string, normalizedText: string, text: string): void {
      members.push({ listId, normalizedText, text, addedAt: new Date(), lastCheckedAt: null });
    },
    memberCount,
    user: {
      findUnique: ({
        where,
      }: {
        where: { id?: string; email?: string };
        select?: Record<string, boolean>;
      }): Promise<UserRow | null> =>
        Promise.resolve(where.id ? (userMap.get(where.id) ?? null) : null),
    },
    trackingList: {
      create: ({
        data,
      }: {
        data: { ownerId: string | null; name: string; geo: string; language: string };
      }): Promise<ListRow> => {
        if (nextCreateError) {
          const err = nextCreateError;
          nextCreateError = null;
          return Promise.reject(err);
        }
        if (dupName(data.ownerId, data.name)) {
          return Promise.reject(p2002(['owner_id', 'name']));
        }
        const row: ListRow = {
          id: randomUUID(),
          ownerId: data.ownerId,
          name: data.name,
          geo: data.geo,
          language: data.language,
          createdAt: new Date(),
        };
        lists.set(row.id, row);
        return Promise.resolve({ ...row });
      },
      findMany: ({
        where,
        include,
      }: {
        where?: { OR?: Array<{ ownerId: string | null }> };
        orderBy?: unknown;
        include?: { _count?: unknown };
      }): Promise<Array<ListRow & { _count?: { members: number } }>> => {
        const rows = [...lists.values()]
          .filter((r) => matchesOwnerWhere(r, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return Promise.resolve(
          rows.map((r) =>
            include?._count ? { ...r, _count: { members: memberCount(r.id) } } : { ...r },
          ),
        );
      },
      findUnique: ({
        where,
        include,
        select,
      }: {
        where: { id: string };
        include?: { members?: unknown };
        select?: { id?: boolean; ownerId?: boolean };
      }): Promise<
        (ListRow & { members?: MemberRow[] }) | Pick<ListRow, 'id' | 'ownerId'> | null
      > => {
        const row = lists.get(where.id);
        if (!row) {
          return Promise.resolve(null);
        }
        if (select) {
          const out: Partial<Pick<ListRow, 'id' | 'ownerId'>> = {};
          if (select.id) {
            out.id = row.id;
          }
          if (select.ownerId) {
            out.ownerId = row.ownerId;
          }
          return Promise.resolve(out as Pick<ListRow, 'id' | 'ownerId'>);
        }
        if (include?.members) {
          const ms = members
            .filter((m) => m.listId === row.id)
            .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime())
            .map((m) => ({ ...m }));
          return Promise.resolve({ ...row, members: ms });
        }
        return Promise.resolve({ ...row });
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: { name?: string };
      }): Promise<ListRow> => {
        if (nextUpdateError) {
          const err = nextUpdateError;
          nextUpdateError = null;
          return Promise.reject(err);
        }
        const row = lists.get(where.id);
        if (!row) {
          return Promise.reject(p2002(['id'])); // service 已先 assertOwnedRow，此路徑不預期
        }
        if (data.name !== undefined && dupName(row.ownerId, data.name, row.id)) {
          return Promise.reject(p2002(['owner_id', 'name']));
        }
        if (data.name !== undefined) {
          row.name = data.name;
        }
        return Promise.resolve({ ...row });
      },
      delete: ({ where }: { where: { id: string } }): Promise<ListRow | null> => {
        const row = lists.get(where.id) ?? null;
        lists.delete(where.id);
        for (let i = members.length - 1; i >= 0; i--) {
          if (members[i].listId === where.id) {
            members.splice(i, 1); // cascade（FK onDelete: Cascade）
          }
        }
        return Promise.resolve(row ? { ...row } : null);
      },
    },
    trackingListMember: {
      create: ({
        data,
      }: {
        data: { listId: string; normalizedText: string; text: string };
      }): Promise<MemberRow> => {
        const m: MemberRow = {
          listId: data.listId,
          normalizedText: data.normalizedText,
          text: data.text,
          addedAt: new Date(),
          lastCheckedAt: null,
        };
        members.push(m);
        return Promise.resolve({ ...m });
      },
    },
  };
}

interface ListView {
  listId: string;
  name: string;
  geo: string;
  language: string;
  createdAt: string;
}

describe('TrackingList CRUD (e2e · TC-64 · FR-28/27)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof makeFakeTrackingDb>;
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    db = makeFakeTrackingDb([
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
      .overrideProvider(TopicClusterProcessor)
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
  const base = '/api/v1/tracking-lists';

  /** session actor 建立清單（帶 cookie + 同源 Origin，過 CSRF）。 */
  const createAs = (cookie: string, body: Record<string, unknown>) =>
    request(server()).post(base).set('Cookie', cookie).set('Origin', ORIGIN).send(body);

  const validBody = { name: 'Running shoes', geo: 'TW', language: 'zh-TW' };

  describe('auth boundary', () => {
    it('未認證（無 cookie / 無 x-api-key）→ 401', async () => {
      const res = await request(server()).get(base);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /tracking-lists (AC-28.1)', () => {
    it('session 建立 → 201 + 回傳清單（ownerId 由 actor 決定，不在回應）', async () => {
      const res = await createAs(cookieA, validBody);
      expect(res.status).toBe(201);
      const body = res.body as ListView;
      expect(body).toMatchObject({ name: 'Running shoes', geo: 'TW', language: 'zh-TW' });
      expect(typeof body.listId).toBe('string');
      expect(typeof body.createdAt).toBe('string');
      expect(JSON.stringify(body).toLowerCase()).not.toContain('ownerid'); // owner 不外洩
    });

    it('缺 name → 400', async () => {
      const res = await createAs(cookieA, { geo: 'TW', language: 'zh-TW' });
      expect(res.status).toBe(400);
    });

    it('空字串 name → 400（@IsNotEmpty，唯一鍵欄位）', async () => {
      const res = await createAs(cookieA, { name: '', geo: 'TW', language: 'zh-TW' });
      expect(res.status).toBe(400);
    });

    it('缺 geo → 400', async () => {
      const res = await createAs(cookieA, { name: 'x', language: 'zh-TW' });
      expect(res.status).toBe(400);
    });

    it('缺 language → 400', async () => {
      const res = await createAs(cookieA, { name: 'x', geo: 'TW' });
      expect(res.status).toBe(400);
    });

    it('未宣告欄位（forbidNonWhitelisted）→ 400', async () => {
      const res = await createAs(cookieA, { ...validBody, ownerId: OWNER_B });
      expect(res.status).toBe(400);
    });

    it('同 owner 重名 → 409（P2002 → ConflictException）', async () => {
      const first = await createAs(cookieA, validBody);
      expect(first.status).toBe(201);
      const dup = await createAs(cookieA, validBody);
      expect(dup.status).toBe(409);
    });

    it('不同 owner 同名 → 各自 201（名稱只在 owner 內唯一）', async () => {
      expect((await createAs(cookieA, { ...validBody, name: 'shared' })).status).toBe(201);
      expect((await createAs(cookieB, { ...validBody, name: 'shared' })).status).toBe(201);
    });

    it('非 P2002 的 DB 錯誤 → 不吞、原樣上拋（500，非 409）', async () => {
      db.failNextCreate(new Error('connection reset'));
      const res = await createAs(cookieA, validBody);
      expect(res.status).toBe(500);
    });

    it('apiKey（機器）建立 → 201（ownerId=null）', async () => {
      const res = await request(server())
        .post(base)
        .set('x-api-key', API_KEY)
        .send({ ...validBody, name: 'machine list' });
      expect(res.status).toBe(201); // x-api-key 免 CSRF（AC-26.3）
    });
  });

  describe('GET /tracking-lists (AC-28.3 · owner scope)', () => {
    it('session 只見自己 + 共享(null)、不見他人；每列帶 memberCount', async () => {
      const a = (await createAs(cookieA, { ...validBody, name: 'A own' })).body as ListView;
      db.seedMember(a.listId, 'running shoes', 'Running Shoes');
      db.seedMember(a.listId, 'trail shoes', 'Trail Shoes');
      await request(server())
        .post(base)
        .set('x-api-key', API_KEY)
        .send({ ...validBody, name: 'shared null' }); // ownerId=null（共享）
      const bOwn = (await createAs(cookieB, { ...validBody, name: 'B own' })).body as ListView;

      const res = await request(server()).get(base).set('Cookie', cookieA);
      expect(res.status).toBe(200);
      const rows = res.body as Array<ListView & { memberCount: number }>;
      const names = rows.map((r) => r.name);
      expect(names).toContain('A own');
      expect(names).toContain('shared null'); // null-owner 共享可見
      expect(names).not.toContain('B own'); // 他人不可見
      expect(rows.map((r) => r.listId)).not.toContain(bOwn.listId);
      expect(rows.find((r) => r.name === 'A own')?.memberCount).toBe(2);
      expect(rows.find((r) => r.name === 'shared null')?.memberCount).toBe(0);
    });

    it('apiKey（機器）見全部（不套 owner 過濾）', async () => {
      await createAs(cookieA, { ...validBody, name: 'A own' });
      await createAs(cookieB, { ...validBody, name: 'B own' });
      const res = await request(server()).get(base).set('x-api-key', API_KEY);
      expect(res.status).toBe(200);
      const names = (res.body as ListView[]).map((r) => r.name);
      expect(names).toEqual(expect.arrayContaining(['A own', 'B own']));
    });

    it('`?ownerId=B` 無法拓寬 scope（owner 僅源自 actor，AC-27.4）', async () => {
      await createAs(cookieA, { ...validBody, name: 'A own' });
      const bOwn = (await createAs(cookieB, { ...validBody, name: 'B own' })).body as ListView;
      const res = await request(server()).get(`${base}?ownerId=${OWNER_B}`).set('Cookie', cookieA);
      expect(res.status).toBe(200);
      const rows = res.body as ListView[];
      expect(rows.map((r) => r.listId)).not.toContain(bOwn.listId); // ?ownerId=B 被忽略
    });
  });

  describe('GET /tracking-lists/:listId (AC-28.3 · cross-owner → 404)', () => {
    it('owner 讀自己 → metadata + 成員基本面', async () => {
      const a = (await createAs(cookieA, validBody)).body as ListView;
      db.seedMember(a.listId, 'running shoes', 'Running Shoes');
      const res = await request(server()).get(`${base}/${a.listId}`).set('Cookie', cookieA);
      expect(res.status).toBe(200);
      const body = res.body as ListView & { members: Array<Record<string, unknown>> };
      expect(body).toMatchObject({ listId: a.listId, name: 'Running shoes', geo: 'TW' });
      expect(body.members).toHaveLength(1);
      expect(body.members[0]).toMatchObject({
        normalizedText: 'running shoes',
        text: 'Running Shoes',
        lastCheckedAt: null,
      });
      expect(typeof body.members[0].addedAt).toBe('string');
    });

    it('非 owner 讀他人清單 → 404（不洩漏存在性）', async () => {
      const a = (await createAs(cookieA, validBody)).body as ListView;
      const res = await request(server()).get(`${base}/${a.listId}`).set('Cookie', cookieB);
      expect(res.status).toBe(404);
    });

    it('不存在的 listId → 404', async () => {
      const res = await request(server()).get(`${base}/${randomUUID()}`).set('Cookie', cookieA);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /tracking-lists/:listId (AC-28.2)', () => {
    const rename = (cookie: string, id: string, name: string) =>
      request(server())
        .patch(`${base}/${id}`)
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .send({ name });

    it('owner 改名 → 200 + 新名', async () => {
      const a = (await createAs(cookieA, validBody)).body as ListView;
      const res = await rename(cookieA, a.listId, 'Trail shoes');
      expect(res.status).toBe(200);
      expect((res.body as ListView).name).toBe('Trail shoes');
    });

    it('非 owner 改名 → 404（且未改動）', async () => {
      const a = (await createAs(cookieA, validBody)).body as ListView;
      const res = await rename(cookieB, a.listId, 'hijacked');
      expect(res.status).toBe(404);
      const check = await request(server()).get(`${base}/${a.listId}`).set('Cookie', cookieA);
      expect((check.body as ListView).name).toBe('Running shoes'); // 未被改
    });

    it('改成同 owner 既有名 → 409', async () => {
      await createAs(cookieA, { ...validBody, name: 'first' });
      const second = (await createAs(cookieA, { ...validBody, name: 'second' })).body as ListView;
      const res = await rename(cookieA, second.listId, 'first');
      expect(res.status).toBe(409);
    });

    it('非 P2002 的 DB 錯誤（改名）→ 不吞、原樣上拋（500，非 409）', async () => {
      const a = (await createAs(cookieA, validBody)).body as ListView;
      db.failNextUpdate(new Error('connection reset'));
      const res = await rename(cookieA, a.listId, 'Trail shoes');
      expect(res.status).toBe(500);
    });

    it('缺 name → 400', async () => {
      const a = (await createAs(cookieA, validBody)).body as ListView;
      const res = await request(server())
        .patch(`${base}/${a.listId}`)
        .set('Cookie', cookieA)
        .set('Origin', ORIGIN)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /tracking-lists/:listId (AC-28.2)', () => {
    const del = (cookie: string, id: string) =>
      request(server()).delete(`${base}/${id}`).set('Cookie', cookie).set('Origin', ORIGIN);

    it('owner 刪除 → 200；後續 GET → 404；成員一併移除（cascade）', async () => {
      const a = (await createAs(cookieA, validBody)).body as ListView;
      db.seedMember(a.listId, 'kw', 'kw');
      const res = await del(cookieA, a.listId);
      expect(res.status).toBe(200);
      expect((res.body as { listId: string }).listId).toBe(a.listId);
      expect(db.memberCount(a.listId)).toBe(0); // cascade
      const after = await request(server()).get(`${base}/${a.listId}`).set('Cookie', cookieA);
      expect(after.status).toBe(404);
    });

    it('非 owner 刪除 → 404（且未刪除）', async () => {
      const a = (await createAs(cookieA, validBody)).body as ListView;
      const res = await del(cookieB, a.listId);
      expect(res.status).toBe(404);
      const still = await request(server()).get(`${base}/${a.listId}`).set('Cookie', cookieA);
      expect(still.status).toBe(200); // A 仍可讀 → 未被刪
    });

    it('不存在的 listId → 404', async () => {
      const res = await del(cookieA, randomUUID());
      expect(res.status).toBe(404);
    });
  });
});
