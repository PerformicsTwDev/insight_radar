import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
import { TopicRepository } from 'src/topics/topic.repository';
import type { ExpandedTopicMember } from 'src/topics/topic.repository';

/**
 * TC-64（FR-28，AC-28.4/28.5/28.7 · FR-27 owner scope）：加成員 HTTP 端到端。
 * - 關鍵字列：normalizedText 伺服器導出、聯集去重（批內 + 對現有）、回 `{ memberCount, added }`。
 * - 主題列：以 fake `TopicRepository.expandTopicToMembers` 展開攤平成關鍵字集合。
 * - 語境守門：item geo/language 與清單層不符 → 400（keyword item 自帶語境、topic item 取展開語境）。
 * - 上限：達 `TRACKING_MAX_MEMBERS_PER_LIST`（.env.test 預設 500）再加入 → 409。
 * - owner scope：非 owner / 不存在清單 → 同一 404（不洩漏存在性）。
 * - 驗證：空 items / 未知 kind / 缺欄位 → 400（全域 ValidationPipe）。
 *
 * DB 以「忠實 Prisma 替身」（e2e 無 Testcontainers，同 T11.2 e2e 先例）；主題展開的**真 DB 語意**
 * （TopicRun × TopicCluster × KeywordClusterAssignment）由 `test/integration/tracking-list-members.int-spec.ts`
 * 覆蓋——此處以 fake repo 隔離、只驗 HTTP 契約 + service 編排（去重/守門/上限/回應）。
 */

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const ORIGIN = 'http://localhost:5173'; // .env.test ALLOWED_ORIGINS（CSRF 白名單）
const ANALYSIS_ID = randomUUID();

/** fake 主題展開表：analysisId|topicName → 展開後成員（含來源 geo/language）。 */
const TOPIC_EXPANSIONS: Record<string, ExpandedTopicMember[]> = {
  [`${ANALYSIS_ID}|Coffee`]: [
    { normalizedText: 'coffee maker', text: 'Coffee Maker', geo: 'TW', language: 'zh-TW' },
    { normalizedText: 'espresso machine', text: 'Espresso Machine', geo: 'TW', language: 'zh-TW' },
  ],
  [`${ANALYSIS_ID}|MismatchGeo`]: [
    { normalizedText: 'imported beans', text: 'Imported Beans', geo: 'US', language: 'en-US' },
  ],
  [`${ANALYSIS_ID}|Empty`]: [],
};

const fakeTopicRepo = {
  expandTopicToMembers: (analysisId: string, topicName: string): Promise<ExpandedTopicMember[]> =>
    Promise.resolve(TOPIC_EXPANSIONS[`${analysisId}|${topicName}`] ?? []),
};

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
}
interface UserRow {
  id: string;
  email: string;
}

/**
 * 忠實 `prisma` 替身：`trackingList`（create/findUnique）、`trackingListMember`（findMany/createMany/count；
 * `@@id([listId,normalizedText])` 聯集去重由 createMany `skipDuplicates` 忠實模擬）、`user`（session 投影）。
 */
function makeFakeDb(users: UserRow[]) {
  const lists = new Map<string, ListRow>();
  const members: MemberRow[] = [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  return {
    reset(): void {
      lists.clear();
      members.length = 0;
    },
    seedMember(listId: string, normalizedText: string, text: string): void {
      members.push({ listId, normalizedText, text });
    },
    user: {
      findUnique: ({ where }: { where: { id?: string } }): Promise<UserRow | null> =>
        Promise.resolve(where.id ? (userMap.get(where.id) ?? null) : null),
    },
    trackingList: {
      create: ({
        data,
      }: {
        data: { ownerId: string | null; name: string; geo: string; language: string };
      }): Promise<ListRow> => {
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
      findUnique: ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
        include?: { members?: unknown };
      }): Promise<(Partial<ListRow> & { members?: MemberRow[] }) | null> => {
        const row = lists.get(where.id);
        if (!row) {
          return Promise.resolve(null);
        }
        if (select) {
          const out: Partial<ListRow> = {};
          if (select.id) out.id = row.id;
          if (select.ownerId) out.ownerId = row.ownerId;
          if (select.geo) out.geo = row.geo;
          if (select.language) out.language = row.language;
          if (select.name) out.name = row.name;
          if (select.createdAt) out.createdAt = row.createdAt;
          return Promise.resolve(out);
        }
        // detail（GET :listId）路徑：帶成員基本面。
        const ms = members.filter((m) => m.listId === row.id).map((m) => ({ ...m }));
        return Promise.resolve({ ...row, members: ms });
      },
    },
    trackingListMember: {
      findMany: ({
        where,
      }: {
        where: { listId: string };
        select?: Record<string, boolean>;
      }): Promise<Array<{ normalizedText: string }>> =>
        Promise.resolve(
          members
            .filter((m) => m.listId === where.listId)
            .map((m) => ({ normalizedText: m.normalizedText })),
        ),
      createMany: ({
        data,
        skipDuplicates,
      }: {
        data: MemberRow[];
        skipDuplicates?: boolean;
      }): Promise<{ count: number }> => {
        let count = 0;
        for (const row of data) {
          const dup = members.some(
            (m) => m.listId === row.listId && m.normalizedText === row.normalizedText,
          );
          if (dup && skipDuplicates) {
            continue; // @@id([listId,normalizedText]) 聯集去重
          }
          members.push({ ...row });
          count += 1;
        }
        return Promise.resolve({ count });
      },
      count: ({ where }: { where: { listId: string } }): Promise<number> =>
        Promise.resolve(members.filter((m) => m.listId === where.listId).length),
    },
  };
}

interface ListView {
  listId: string;
  geo: string;
  language: string;
}
interface AddResult {
  memberCount: number;
  added: number;
}

describe('TrackingList add members (e2e · TC-64 · FR-28/27 · AC-28.4/28.5/28.7)', () => {
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
      .overrideProvider(TopicClusterProcessor)
      .useValue({})
      .overrideProvider(TopicRepository)
      .useValue(fakeTopicRepo)
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

  /** 建一個 TW/zh-TW 清單（session A），回其 view。 */
  const createList = async (name = 'Running shoes'): Promise<ListView> => {
    const res = await request(server())
      .post(base)
      .set('Cookie', cookieA)
      .set('Origin', ORIGIN)
      .send({ name, geo: 'TW', language: 'zh-TW' });
    expect(res.status).toBe(201);
    return res.body as ListView;
  };

  const addMembers = (cookie: string, listId: string, items: unknown) =>
    request(server())
      .post(`${base}/${listId}/members`)
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ items });

  const kw = (text: string, geo = 'TW', language = 'zh-TW') => ({
    kind: 'keyword',
    text,
    geo,
    language,
  });

  describe('keyword items (AC-28.4)', () => {
    it('新增關鍵字列 → 200 { memberCount, added }；normalizedText 伺服器導出', async () => {
      const list = await createList();
      const res = await addMembers(cookieA, list.listId, [kw('Running Shoes'), kw('Trail Shoes')]);
      expect(res.status).toBe(200);
      expect(res.body as AddResult).toEqual({ memberCount: 2, added: 2 });

      const detail = await request(server()).get(`${base}/${list.listId}`).set('Cookie', cookieA);
      const norms = (detail.body as { members: Array<{ normalizedText: string }> }).members
        .map((m) => m.normalizedText)
        .sort();
      expect(norms).toEqual(['running shoes', 'trail shoes']);
    });

    it('批內去重（同 normalizedText 只算一次）→ added=1', async () => {
      const list = await createList();
      const res = await addMembers(cookieA, list.listId, [
        kw('Running Shoes'),
        kw('running shoes'),
      ]);
      expect(res.status).toBe(200);
      expect(res.body as AddResult).toEqual({ memberCount: 1, added: 1 });
    });

    it('對現有成員去重（已存在 → 不重複建立）→ added=0、memberCount 不變', async () => {
      const list = await createList();
      await addMembers(cookieA, list.listId, [kw('Running Shoes')]);
      const res = await addMembers(cookieA, list.listId, [kw('running shoes')]);
      expect(res.status).toBe(200);
      expect(res.body as AddResult).toEqual({ memberCount: 1, added: 0 });
    });
  });

  describe('topic items — expand + flatten (AC-28.4)', () => {
    it('主題列展開攤平成該群關鍵字 → 200 added=2', async () => {
      const list = await createList();
      const res = await addMembers(cookieA, list.listId, [
        { kind: 'topic', analysisId: ANALYSIS_ID, topicName: 'Coffee' },
      ]);
      expect(res.status).toBe(200);
      expect(res.body as AddResult).toEqual({ memberCount: 2, added: 2 });

      const detail = await request(server()).get(`${base}/${list.listId}`).set('Cookie', cookieA);
      const norms = (detail.body as { members: Array<{ normalizedText: string }> }).members
        .map((m) => m.normalizedText)
        .sort();
      expect(norms).toEqual(['coffee maker', 'espresso machine']);
    });

    it('無此主題 / 空展開 → 200 added=0（不 400）', async () => {
      const list = await createList();
      const res = await addMembers(cookieA, list.listId, [
        { kind: 'topic', analysisId: ANALYSIS_ID, topicName: 'Empty' },
      ]);
      expect(res.status).toBe(200);
      expect(res.body as AddResult).toEqual({ memberCount: 0, added: 0 });
    });
  });

  describe('context guard (AC-28.5)', () => {
    it('關鍵字列 geo 與清單不符 → 400', async () => {
      const list = await createList();
      const res = await addMembers(cookieA, list.listId, [kw('Running Shoes', 'US', 'zh-TW')]);
      expect(res.status).toBe(400);
    });

    it('關鍵字列 language 與清單不符 → 400', async () => {
      const list = await createList();
      const res = await addMembers(cookieA, list.listId, [kw('Running Shoes', 'TW', 'en-US')]);
      expect(res.status).toBe(400);
    });

    it('主題列展開後語境不符 → 400（不默默改寫）', async () => {
      const list = await createList();
      const res = await addMembers(cookieA, list.listId, [
        { kind: 'topic', analysisId: ANALYSIS_ID, topicName: 'MismatchGeo' },
      ]);
      expect(res.status).toBe(400);
    });
  });

  describe('limit (AC-28.7)', () => {
    it('達 TRACKING_MAX_MEMBERS_PER_LIST（500）再加入 → 409', async () => {
      const list = await createList();
      for (let i = 0; i < 500; i++) {
        db.seedMember(list.listId, `kw-${i}`, `kw ${i}`);
      }
      const res = await addMembers(cookieA, list.listId, [kw('Overflow Keyword')]);
      expect(res.status).toBe(409);
    });
  });

  describe('owner scope + validation', () => {
    it('非 owner 加成員 → 404（不洩漏存在性）', async () => {
      const list = await createList();
      const res = await addMembers(cookieB, list.listId, [kw('Running Shoes')]);
      expect(res.status).toBe(404);
    });

    it('不存在的 listId → 404', async () => {
      const res = await addMembers(cookieA, randomUUID(), [kw('Running Shoes')]);
      expect(res.status).toBe(404);
    });

    it('空 items → 400', async () => {
      const list = await createList();
      const res = await addMembers(cookieA, list.listId, []);
      expect(res.status).toBe(400);
    });

    it('未知 kind → 400', async () => {
      const list = await createList();
      const res = await addMembers(cookieA, list.listId, [{ kind: 'bogus', text: 'x' }]);
      expect(res.status).toBe(400);
    });

    it('keyword 缺 text → 400', async () => {
      const list = await createList();
      const res = await addMembers(cookieA, list.listId, [
        { kind: 'keyword', geo: 'TW', language: 'zh-TW' },
      ]);
      expect(res.status).toBe(400);
    });

    it('topic 缺 topicName → 400', async () => {
      const list = await createList();
      const res = await addMembers(cookieA, list.listId, [
        { kind: 'topic', analysisId: ANALYSIS_ID },
      ]);
      expect(res.status).toBe(400);
    });
  });
});
