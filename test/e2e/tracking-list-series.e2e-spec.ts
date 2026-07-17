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
import {
  JOURNEY_JOB_EVENTS_CONNECTION,
  JOURNEY_QUEUE_EVENTS,
} from 'src/queue/journey-job-events.constants';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import { JourneyProcessor } from 'src/journey/journey.processor';
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';

/**
 * TC-66（FR-30 · AC-30.1~30.5 · FR-27 owner scope）：`GET /tracking-lists/:listId/series` 的 HTTP 端到端。
 * - 未認證→401；非 owner / 不存在→同一 404；非法 `from`/`to`→400（DTO `@IsDate`）；`granularity` reserved 被接受。
 * - 200：`{ list, axis, total, members:[{…,latest,series}], summary }` 契約形狀；斷點 null≠0、total 為數字。
 *
 * DB 以「忠實 Prisma 替身」（e2e project 無 Testcontainers；同 tracking-list-crud.e2e 先例）——真實 Postgres
 * 語意（fetchedAt 過濾 / IN 成員 scope / cpc micros）由 `test/integration/tracking-series.int-spec.ts` 覆蓋，
 * 組裝正確性由 `src/tracking/volume-series.spec.ts` 純函式單測把關，三者互補、防替身漂移。
 */

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();

const T0 = new Date('2026-01-01T00:00:00.000Z');
const T1 = new Date('2026-02-01T00:00:00.000Z');

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
interface SnapRow {
  listId: string;
  normalizedText: string;
  fetchedAt: Date;
  avgMonthlySearches: number | null;
  competition: string | null;
  cpcLowMicros: bigint | null;
}
interface UserRow {
  id: string;
  email: string;
}

/**
 * 忠實 `prisma` 替身：`trackingList.findUnique(include.members)`、`volumeSnapshot.findMany`（listId +
 * `normalizedText IN` + `fetchedAt` gte/lte + orderBy asc）、`user`（SessionAuthResolver 投影）。
 */
function makeFakeSeriesDb(users: UserRow[]) {
  const lists = new Map<string, ListRow>();
  const members: MemberRow[] = [];
  const snaps: SnapRow[] = [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  return {
    reset(): void {
      lists.clear();
      members.length = 0;
      snaps.length = 0;
    },
    seedList(ownerId: string | null, name = 'Shoes'): string {
      const id = randomUUID();
      lists.set(id, { id, ownerId, name, geo: 'TW', language: 'zh-TW', createdAt: new Date() });
      return id;
    },
    seedMember(listId: string, normalizedText: string, text: string): void {
      members.push({ listId, normalizedText, text, addedAt: T0, lastCheckedAt: T1 });
    },
    seedSnap(row: Omit<SnapRow, 'listId'> & { listId: string }): void {
      snaps.push(row);
    },
    user: {
      findUnique: ({ where }: { where: { id?: string } }): Promise<UserRow | null> =>
        Promise.resolve(where.id ? (userMap.get(where.id) ?? null) : null),
    },
    trackingList: {
      findUnique: ({
        where,
        include,
      }: {
        where: { id: string };
        include?: { members?: unknown };
      }): Promise<(ListRow & { members: MemberRow[] }) | null> => {
        const row = lists.get(where.id);
        if (!row) {
          return Promise.resolve(null);
        }
        const ms = include?.members
          ? members
              .filter((m) => m.listId === row.id)
              .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime())
              .map((m) => ({ ...m }))
          : [];
        return Promise.resolve({ ...row, members: ms });
      },
    },
    volumeSnapshot: {
      findMany: ({
        where,
      }: {
        where: {
          listId: string;
          normalizedText: { in: string[] };
          fetchedAt?: { gte?: Date; lte?: Date };
        };
      }): Promise<SnapRow[]> => {
        const keys = new Set(where.normalizedText.in);
        const rows = snaps
          .filter(
            (s) =>
              s.listId === where.listId &&
              keys.has(s.normalizedText) &&
              (where.fetchedAt?.gte === undefined || s.fetchedAt >= where.fetchedAt.gte) &&
              (where.fetchedAt?.lte === undefined || s.fetchedAt <= where.fetchedAt.lte),
          )
          .sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())
          .map((s) => ({ ...s }));
        return Promise.resolve(rows);
      },
    },
  };
}

interface SeriesBody {
  list: { listId: string; name: string; geo: string; language: string };
  axis: string[];
  total: number[];
  members: Array<{
    normalizedText: string;
    text: string;
    addedAt: string;
    lastCheckedAt: string | null;
    latest: { fetchedAt: string; avgMonthlySearches: number | null; cpc: number | null } | null;
    series: Array<{
      fetchedAt: string;
      avgMonthlySearches: number | null;
      competition: string | null;
      cpc: number | null;
    }>;
  }>;
  summary: { memberCount: number; latestFetchedAt: string | null };
}

describe('TrackingList series (e2e · TC-66 · FR-30/27)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof makeFakeSeriesDb>;
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    db = makeFakeSeriesDb([
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
  const base = '/api/v1/tracking-lists';
  const seriesUrl = (id: string, qs = ''): string => `${base}/${id}/series${qs}`;

  /** 建 A 擁有的清單 + coffee/tea 兩成員 + 快照（coffee T0/T1、tea T1）；回 listId。 */
  function seedScenario(): string {
    const listId = db.seedList(OWNER_A);
    db.seedMember(listId, 'coffee', 'Coffee');
    db.seedMember(listId, 'tea', 'Tea');
    db.seedSnap({
      listId,
      normalizedText: 'coffee',
      fetchedAt: T0,
      avgMonthlySearches: 100,
      competition: 'LOW',
      cpcLowMicros: 500000n,
    });
    db.seedSnap({
      listId,
      normalizedText: 'coffee',
      fetchedAt: T1,
      avgMonthlySearches: 120,
      competition: 'HIGH',
      cpcLowMicros: 1500000n,
    });
    db.seedSnap({
      listId,
      normalizedText: 'tea',
      fetchedAt: T1,
      avgMonthlySearches: 50,
      competition: 'LOW',
      cpcLowMicros: null,
    });
    return listId;
  }

  describe('auth boundary', () => {
    it('未認證（無 cookie / 無 x-api-key）→ 401', async () => {
      const listId = seedScenario();
      const res = await request(server()).get(seriesUrl(listId));
      expect(res.status).toBe(401);
    });
  });

  describe('owner scope (AC-30.4)', () => {
    it('non-owner → 404（不洩漏存在性）', async () => {
      const listId = seedScenario();
      const res = await request(server()).get(seriesUrl(listId)).set('Cookie', cookieB);
      expect(res.status).toBe(404);
    });

    it('不存在的 listId → 404', async () => {
      const res = await request(server()).get(seriesUrl(randomUUID())).set('Cookie', cookieA);
      expect(res.status).toBe(404);
    });
  });

  describe('query validation (from/to via DTO)', () => {
    it('非法 from（非日期字串）→ 400', async () => {
      const listId = seedScenario();
      const res = await request(server())
        .get(seriesUrl(listId, '?from=not-a-date'))
        .set('Cookie', cookieA);
      expect(res.status).toBe(400);
    });

    it('未宣告 query 欄位（forbidNonWhitelisted）→ 400', async () => {
      const listId = seedScenario();
      const res = await request(server()).get(seriesUrl(listId, '?bogus=1')).set('Cookie', cookieA);
      expect(res.status).toBe(400);
    });

    it('granularity（reserved）被接受 → 200', async () => {
      const listId = seedScenario();
      const res = await request(server())
        .get(seriesUrl(listId, '?granularity=month'))
        .set('Cookie', cookieA);
      expect(res.status).toBe(200);
    });
  });

  describe('contract shape (AC-30.1/30.2/30.5)', () => {
    it('owner reads own → 200 with { list, axis, total, members, summary }; breakpoint null≠0', async () => {
      const listId = seedScenario();
      const res = await request(server()).get(seriesUrl(listId)).set('Cookie', cookieA);
      expect(res.status).toBe(200);
      const body = res.body as SeriesBody;

      expect(body.list).toEqual({ listId, name: 'Shoes', geo: 'TW', language: 'zh-TW' });
      expect(body.axis).toEqual([T0.toISOString(), T1.toISOString()]);
      expect(body.total).toEqual([100, 170]); // T0: 100; T1: 120+50
      expect(body.summary).toEqual({ memberCount: 2, latestFetchedAt: T1.toISOString() });

      const coffee = body.members.find((m) => m.normalizedText === 'coffee')!;
      expect(coffee.series.map((p) => p.avgMonthlySearches)).toEqual([100, 120]);
      expect(coffee.series[0].cpc).toBe(0.5);
      expect(coffee.latest).toMatchObject({ fetchedAt: T1.toISOString(), avgMonthlySearches: 120 });

      const tea = body.members.find((m) => m.normalizedText === 'tea')!;
      expect(tea.series.map((p) => p.avgMonthlySearches)).toEqual([null, 50]); // T0 斷點 null（非 0）
      expect(tea.series[0]).toMatchObject({
        avgMonthlySearches: null,
        competition: null,
        cpc: null,
      });
      expect(tea.series[1].cpc).toBeNull(); // null micros → null
    });

    it('empty state（members but no snapshots）→ axis=[], latestFetchedAt=null, series=[]', async () => {
      const listId = db.seedList(OWNER_A);
      db.seedMember(listId, 'coffee', 'Coffee');
      const res = await request(server()).get(seriesUrl(listId)).set('Cookie', cookieA);
      expect(res.status).toBe(200);
      const body = res.body as SeriesBody;
      expect(body.axis).toEqual([]);
      expect(body.total).toEqual([]);
      expect(body.summary.latestFetchedAt).toBeNull();
      expect(body.members[0].series).toEqual([]);
      expect(body.members[0].latest).toBeNull();
    });
  });
});
