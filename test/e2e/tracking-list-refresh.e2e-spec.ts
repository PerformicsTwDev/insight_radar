import { randomUUID } from 'node:crypto';
import { overrideBackgroundWorkers } from './helpers/background-workers';
import { getQueueToken } from '@nestjs/bullmq';
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
import { BULL_CONNECTION, TRACKING_REFRESH_QUEUE } from 'src/queue/queue.constants';
import { TopicRepository } from 'src/topics/topic.repository';
import { manualRefreshJobId } from 'src/tracking';

/**
 * TC-65（FR-29 AC-29.6 · FR-27 owner scope · NFR-16）：手動即時刷新 HTTP 端到端。
 * - `POST /api/v1/tracking-lists/:listId/refresh` → 202 `{ status:'queued', listId }`、入列 job（jobId dedup）。
 * - owner scope（service 層強制）：非 owner / 不存在清單 → 同一 404（不洩漏存在性），且**不入列**。
 * - 認證邊界：缺認證 → 401；x-api-key 機器 actor 不套 owner 過濾 → 202。
 *
 * queue 以 `getQueueToken` override 成 fake（不直接 mock bullmq 類別，test-authoring §6）；processor 以 `{}`
 * override（不啟真 worker/scheduler）；DB 為忠實 `prisma` 替身（e2e 無 Testcontainers，同 tracking e2e 先例）。
 */

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const ORIGIN = 'http://localhost:5173';
const API_KEY = 'test-api-key';

interface ListRow {
  id: string;
  ownerId: string | null;
}
interface UserRow {
  id: string;
  email: string;
}

/** 忠實 `prisma` 替身：`trackingList.findUnique`（owner-scope 只需 id/ownerId）+ `user`（session 投影）。 */
function makeFakeDb(users: UserRow[]) {
  const lists = new Map<string, ListRow>();
  const userMap = new Map(users.map((u) => [u.id, u]));
  return {
    reset(): void {
      lists.clear();
    },
    seedList(ownerId: string | null): string {
      const id = randomUUID();
      lists.set(id, { id, ownerId });
      return id;
    },
    user: {
      findUnique: ({ where }: { where: { id?: string } }): Promise<UserRow | null> =>
        Promise.resolve(where.id ? (userMap.get(where.id) ?? null) : null),
    },
    trackingList: {
      findUnique: ({ where }: { where: { id: string } }): Promise<ListRow | null> =>
        Promise.resolve(lists.get(where.id) ?? null),
    },
  };
}

interface QueuedResult {
  status: string;
  listId: string;
}

describe('TrackingList manual refresh (e2e · TC-65 · FR-29 AC-29.6 · FR-27)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof makeFakeDb>;
  let queueAdd: jest.Mock;
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    db = makeFakeDb([
      { id: OWNER_A, email: 'a@example.com' },
      { id: OWNER_B, email: 'b@example.com' },
    ]);
    queueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
    const fakeRefreshQueue = {
      add: queueAdd,
      upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await overrideBackgroundWorkers(
      Test.createTestingModule({ imports: [AppModule] }),
    )
      .overrideProvider(getQueueToken(TRACKING_REFRESH_QUEUE))
      .useValue(fakeRefreshQueue)
      .overrideProvider(BULL_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(KeywordAnalysisProcessor)
      .useValue({})
      .overrideProvider(TopicRepository)
      .useValue({ expandTopicToMembers: () => Promise.resolve([]) })
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
    queueAdd.mockClear();
  });

  const server = (): App => app.getHttpServer();
  const refresh = (cookie: string | null, listId: string, apiKey?: string) => {
    const req = request(server())
      .post(`/api/v1/tracking-lists/${listId}/refresh`)
      .set('Origin', ORIGIN);
    if (cookie) req.set('Cookie', cookie);
    if (apiKey) req.set('x-api-key', apiKey);
    return req;
  };

  it('owner → 202 { status: queued, listId } and enqueues a single-flight job (jobId dedup)', async () => {
    const listId = db.seedList(OWNER_A);

    const res = await refresh(cookieA, listId);

    expect(res.status).toBe(202);
    expect(res.body as QueuedResult).toEqual({ status: 'queued', listId });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const [, , opts] = queueAdd.mock.calls[0] as [string, unknown, { jobId: string }];
    expect(opts.jobId).toBe(manualRefreshJobId(listId));
  });

  it('non-owner session → 404 and does NOT enqueue (owner-scope in service, FR-27)', async () => {
    const listId = db.seedList(OWNER_A);
    const res = await refresh(cookieB, listId);
    expect(res.status).toBe(404);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('unknown listId → 404 (indistinguishable from unauthorized) and does NOT enqueue', async () => {
    const res = await refresh(cookieA, randomUUID());
    expect(res.status).toBe(404);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('missing auth → 401', async () => {
    const listId = db.seedList(OWNER_A);
    const res = await refresh(null, listId);
    expect(res.status).toBe(401);
  });

  it('x-api-key machine actor is not owner-filtered → 202', async () => {
    const listId = db.seedList(OWNER_A);
    const res = await refresh(null, listId, API_KEY);
    expect(res.status).toBe(202);
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });
});
