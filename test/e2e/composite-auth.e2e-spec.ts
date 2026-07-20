import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { PrismaService } from 'src/prisma';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';
import {
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from 'src/queue/topic-job-events.constants';
import {
  JOURNEY_JOB_EVENTS_CONNECTION,
  JOURNEY_QUEUE_EVENTS,
} from 'src/queue/journey-job-events.constants';
import { getQueueToken } from '@nestjs/bullmq';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import { JourneyProcessor } from 'src/journey/journey.processor';
import {
  CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION,
  CUSTOM_CLASSIFY_QUEUE_EVENTS,
} from 'src/queue/custom-classify-job-events.constants';
import {
  AI_SEARCH_JOB_EVENTS_CONNECTION,
  AI_SEARCH_QUEUE_EVENTS,
} from 'src/queue/ai-search-job-events.constants';
import { CustomClassifyAssignProcessor } from 'src/custom-classify/custom-classify-assign.processor';
import { AiSearchProcessor } from 'src/ai-search/ai-search.processor';
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';

/**
 * TC-60（FR-25 · AC-25.1~25.4）：`CompositeAuthGuard`——同一組受保護 **資料** 端點可由「瀏覽器 session」
 * **或**「機器 x-api-key」任一通過；皆無/皆無效→401；`@Public`（/health、/auth/*）仍免認證（/health 不破）。
 *
 * `request.user.kind`（session vs apiKey）由 `composite-auth.guard.spec` 單元直接斷言（不新增 production
 * probe 路由）；此 e2e 只驗「通過/拒絕/公開可達」的對外行為。DB 以忠實 `prisma` 替身（e2e project 無
 * Testcontainers；同 auth-endpoints/history-list 先例）：`user` 支援 register/login + session 解析的 by-id 投影，
 * `keywordAnalysis.findUnique` 回 null（受保護資料端點通過守衛後回 404≠401，證明 401 來自認證而非端點恆拒）。
 */

const API_KEY = 'test-api-key'; // = .env.test API_KEY
const PASSWORD = 'correct-horse-battery';
const ANALYSIS_ID = randomUUID();
const KEYWORDS_PATH = `/api/v1/keyword-analyses/${ANALYSIS_ID}/keywords`;

interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
}

/** 忠實 `prisma.user` 替身：`email` 唯一（重複 create→P2002 語意由 register 用不到此路徑，保持簡潔以 upsert-by-email）。 */
function makeFakePrisma() {
  const rows = new Map<string, UserRow>();
  const byEmail = (email: string): UserRow | undefined =>
    [...rows.values()].find((r) => r.email === email);
  const project = (row: UserRow, select?: Record<string, boolean>): Partial<UserRow> => {
    if (!select) {
      return { ...row };
    }
    const out: Partial<UserRow> = {};
    if (select.id) {
      out.id = row.id;
    }
    if (select.email) {
      out.email = row.email;
    }
    if (select.passwordHash) {
      out.passwordHash = row.passwordHash;
    }
    return out;
  };
  return {
    user: {
      create: ({
        data,
        select,
      }: {
        data: { email: string; passwordHash: string };
        select?: Record<string, boolean>;
      }): Promise<Partial<UserRow>> => {
        const row: UserRow = {
          id: randomUUID(),
          email: data.email,
          passwordHash: data.passwordHash,
        };
        rows.set(row.id, row);
        return Promise.resolve(project(row, select));
      },
      findUnique: ({
        where,
        select,
      }: {
        where: { email?: string; id?: string };
        select?: Record<string, boolean>;
      }): Promise<Partial<UserRow> | null> => {
        const row = where.id ? rows.get(where.id) : where.email ? byEmail(where.email) : undefined;
        return Promise.resolve(row ? project(row, select) : null);
      },
    },
    // 受保護資料端點所需（回 null → 通過守衛後 service 拋 404，≠401）。
    keywordAnalysis: { findUnique: (): Promise<null> => Promise.resolve(null) },
    snapshotRow: { findMany: (): Promise<never[]> => Promise.resolve([]) },
  };
}

describe('composite auth (e2e · TC-60 · FR-25)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getQueueToken(KEYWORD_ANALYSIS_QUEUE))
      .useValue({ add: jest.fn(), getJob: jest.fn() })
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
      .overrideProvider(AI_SEARCH_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(AI_SEARCH_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(AiSearchProcessor)
      .useValue({})
      .overrideProvider(TopicClusterProcessor)
      .useValue({})
      .overrideProvider(TrackingRefreshProcessor)
      .useValue({})
      .overrideProvider(PrismaService)
      .useValue(makeFakePrisma())
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = (): App => app.getHttpServer();

  /** 註冊 + 登入 → 回可續用的 `Cookie` header（帶 opaque sid）。也順帶證明 @Public register/login 可達。 */
  async function registerAndLogin(email: string): Promise<string> {
    const reg = await request(server())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD });
    expect(reg.status).toBe(201); // @Public register 可達（無 session/api-key）
    const login = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(login.status).toBe(200); // @Public login 可達，設 session cookie
    const raw = login.headers['set-cookie'] as unknown as string[] | string | undefined;
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const sid = arr.find((c) => c.startsWith('sid='));
    if (!sid) {
      throw new Error('login did not set a sid cookie');
    }
    return sid.split(';')[0]; // 'sid=abc'
  }

  it('AC-25.1: a valid session passes the protected data route (not 401)', async () => {
    const cookie = await registerAndLogin('session-user@example.com');
    const res = await request(server()).get(KEYWORDS_PATH).set('Cookie', cookie);
    expect(res.status).not.toBe(401); // 通過守衛（找不到分析 → 404），未被認證擋下
    expect(res.status).toBe(404);
  });

  it('AC-25.2: a valid x-api-key passes the protected data route (machine actor, unchanged)', async () => {
    const res = await request(server()).get(KEYWORDS_PATH).set('x-api-key', API_KEY);
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(404);
  });

  it('AC-25.3: neither a session nor a valid x-api-key → 401', async () => {
    const none = await request(server()).get(KEYWORDS_PATH);
    expect(none.status).toBe(401);
    const wrong = await request(server()).get(KEYWORDS_PATH).set('x-api-key', 'not-the-key');
    expect(wrong.status).toBe(401);
  });

  it('AC-25.4: @Public /health reachable with no credentials (not auth-gated)', async () => {
    const res = await request(server()).get('/health');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect([200, 503]).toContain(res.status); // 抵達 terminus handler（in-process mock DB → 可能 503）
  });
});
