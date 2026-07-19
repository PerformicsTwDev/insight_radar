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
import {
  CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION,
  CUSTOM_CLASSIFY_QUEUE_EVENTS,
} from 'src/queue/custom-classify-job-events.constants';
import { CustomClassifyAssignProcessor } from 'src/custom-classify/custom-classify-assign.processor';
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';

/**
 * TC-72（端點部分，FR-36 / NFR-17 · AC-36.1/36.4/36.5 · FR-27 owner scope）：capture ingestion HTTP 端到端。
 *
 * T13.2 範圍（見筆記界定）：端點 + DTO 驗證 + `CompositeAuthGuard` + 基本 raw append-only 落庫 + 回應
 * `202 {accepted,deduped,ids}`。**content-hash idempotency 的去重行為（deduped>0、回既有 id）＋ schemaVersion
 * allowlist 屬 T13.3**——本檔只驗 `deduped=0`、逐筆落庫、認證/歸屬、批次/body 形狀守門。
 *
 * DB 以「忠實 Prisma 替身」（e2e 無 Testcontainers，同 T11.2/T11.3 e2e 先例）：只驗 HTTP 契約 + service 編排
 * （落庫筆數/ownerId 歸屬/回應形狀/守門），content-hash 唯一鍵的**真 DB 去重**留待 T13.3 integration。
 */

const OWNER = randomUUID();
const API_KEY = 'test-api-key'; // .env.test API_KEY
const ORIGIN = 'http://localhost:5173'; // .env.test ALLOWED_ORIGINS（CSRF 白名單）

interface CaptureRow {
  id: string;
  ownerId: string | null;
  source: string;
  schemaVersion: string;
  channel: string | null;
  platform: string | null;
  contentHash: string;
  payload: unknown;
  mapStatus: string;
  capturedAt: Date;
}
interface UserRow {
  id: string;
  email: string;
}

/** 忠實 `prisma` 替身：`capture.createMany`（append-only 落庫）＋ `user.findUnique`（session 投影）。 */
function makeFakeDb(users: UserRow[]) {
  const captures: CaptureRow[] = [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  return {
    captures,
    reset(): void {
      captures.length = 0;
    },
    user: {
      findUnique: ({ where }: { where: { id?: string } }): Promise<UserRow | null> =>
        Promise.resolve(where.id ? (userMap.get(where.id) ?? null) : null),
    },
    capture: {
      createMany: ({ data }: { data: CaptureRow[] }): Promise<{ count: number }> => {
        for (const row of data) {
          captures.push({ ...row });
        }
        return Promise.resolve({ count: data.length });
      },
    },
  };
}

interface IngestResult {
  accepted: number;
  deduped: number;
  ids: string[];
}

describe('TC-72: capture ingestion endpoint (e2e · FR-36 · AC-36.1/36.4/36.5)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof makeFakeDb>;
  let cookie: string;

  beforeAll(async () => {
    db = makeFakeDb([{ id: OWNER, email: 'owner@example.com' }]);
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
    cookie = `sid=${await sessions.create(OWNER)}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    db.reset();
  });

  const server = (): App => app.getHttpServer();
  const url = '/api/v1/captures';

  const validBody = (overrides: Record<string, unknown> = {}) => ({
    source: 'extension',
    channel: 'chatGpt',
    schemaVersion: 'v1',
    items: [
      { query: 'running shoes', answer: 'A' },
      { query: 'trail shoes', answer: 'B' },
    ],
    ...overrides,
  });

  const asSession = (body: object) =>
    request(server()).post(url).set('Cookie', cookie).set('Origin', ORIGIN).send(body);
  const asApiKey = (body: object) =>
    request(server()).post(url).set('x-api-key', API_KEY).send(body);

  describe('happy path (AC-36.1)', () => {
    it('valid batch (session) → 202 { accepted, deduped, ids }; deduped=0; ids match item count', async () => {
      const res = await asSession(validBody());
      expect(res.status).toBe(202);
      const body = res.body as IngestResult;
      expect(body.accepted).toBe(2);
      expect(body.deduped).toBe(0);
      expect(Array.isArray(body.ids)).toBe(true);
      expect(body.ids).toHaveLength(2);
      // raw append-only 落庫：兩筆 Capture，payload 保留原始 item。
      expect(db.captures).toHaveLength(2);
      expect(db.captures.map((c) => c.payload)).toEqual([
        { query: 'running shoes', answer: 'A' },
        { query: 'trail shoes', answer: 'B' },
      ]);
    });

    it('Social capture (platform set, no channel) → 202; persists platform, channel null', async () => {
      const body = {
        source: 'extension',
        platform: 'threads',
        schemaVersion: 'v1',
        items: [{ permalink: 'https://threads.net/p/1', content: 'hi' }],
      };
      const res = await asSession(body);
      expect(res.status).toBe(202);
      expect(db.captures).toHaveLength(1);
      expect(db.captures[0].platform).toBe('threads');
      expect(db.captures[0].channel).toBeNull();
    });

    it('persists source/channel/schemaVersion and a non-empty contentHash per row', async () => {
      await asSession(
        validBody({ source: 'extension', channel: 'googleSearch', schemaVersion: 'v2' }),
      );
      expect(db.captures).toHaveLength(2);
      for (const row of db.captures) {
        expect(row.source).toBe('extension');
        expect(row.channel).toBe('googleSearch');
        expect(row.schemaVersion).toBe('v2');
        expect(typeof row.contentHash).toBe('string');
        expect(row.contentHash.length).toBeGreaterThan(0);
      }
      // 不同 item → 不同 contentHash。
      expect(db.captures[0].contentHash).not.toBe(db.captures[1].contentHash);
    });
  });

  describe('auth + ownership (AC-36.4 · FR-27)', () => {
    it('unauthenticated (no cookie, no key) → 401; nothing persisted', async () => {
      const res = await request(server()).post(url).set('Origin', ORIGIN).send(validBody());
      expect(res.status).toBe(401);
      expect(db.captures).toHaveLength(0);
    });

    it('session actor → ownerId = user.id on every row', async () => {
      await asSession(validBody());
      expect(db.captures.every((c) => c.ownerId === OWNER)).toBe(true);
    });

    it('x-api-key actor (machine) → ownerId = null on every row', async () => {
      const res = await asApiKey(validBody());
      expect(res.status).toBe(202);
      expect(db.captures.every((c) => c.ownerId === null)).toBe(true);
    });
  });

  describe('DTO validation (AC-36.1)', () => {
    it('unknown source → 400', async () => {
      const res = await asSession(validBody({ source: 'bogus' }));
      expect(res.status).toBe(400);
    });
    it('missing schemaVersion → 400', async () => {
      const rest: Record<string, unknown> = { ...validBody() };
      delete rest.schemaVersion;
      const res = await asSession(rest);
      expect(res.status).toBe(400);
    });
    it('empty items → 400', async () => {
      const res = await asSession(validBody({ items: [] }));
      expect(res.status).toBe(400);
    });
    it('unknown channel enum → 400', async () => {
      const res = await asSession(validBody({ channel: 'notAChannel' }));
      expect(res.status).toBe(400);
    });
  });

  describe('request-shape guards (AC-36.5)', () => {
    // items 數 > INGEST_BATCH_MAX（.env.test=5）→ 413，先於 contentHash/DB（DoS 前置守門）。
    it('items count > INGEST_BATCH_MAX → 413; nothing persisted', async () => {
      const items = Array.from({ length: 6 }, (_, i) => ({ n: i }));
      const res = await asSession(validBody({ items }));
      expect(res.status).toBe(413);
      expect(db.captures).toHaveLength(0);
    });

    // 獨立 body 上限：captures parser（.env.test INGEST_BODY_LIMIT_MB=2）> 全域 BODY_LIMIT_MB=1。
    it('body larger than global BODY_LIMIT_MB but within INGEST_BODY_LIMIT_MB → accepted (202)', async () => {
      const big = 'x'.repeat(1.5 * 1024 * 1024); // ~1.5MB：> 全域 1MB、< ingest 2MB
      const res = await asSession(validBody({ items: [{ text: big }] }));
      expect(res.status).toBe(202);
    });

    it('body over INGEST_BODY_LIMIT_MB → 413', async () => {
      const over = 'x'.repeat(2.5 * 1024 * 1024); // ~2.5MB：> ingest 2MB
      const res = await asSession(validBody({ items: [{ text: over }] }));
      expect(res.status).toBe(413);
    });
  });
});
