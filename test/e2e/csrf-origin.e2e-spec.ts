import { randomUUID } from 'node:crypto';
import { overrideBackgroundWorkers } from './helpers/background-workers';
import { getQueueToken } from '@nestjs/bullmq';
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

/**
 * TC-61（FR-26 · AC-26.1~26.4）：CSRF Origin 檢查（`CsrfGuard`，`CompositeAuthGuard` 之後執行）。
 * SameSite=Lax 之上的第二層：以 **session cookie** 認證的狀態變更請求（`POST/PUT/PATCH/DELETE`）
 * 若 `Origin`（或 `Referer` fallback）不在 `ALLOWED_ORIGINS`（`.env.test`＝`http://localhost:5173`）→ 403；
 * 白名單內 → 通過。`x-api-key`（機器 actor）與 `GET/HEAD` 免檢查。
 *
 * 替身與 composite-auth e2e 一致（e2e project 無 Testcontainers）：忠實 `prisma.user` 支援 register/login +
 * by-id session 解析；`keywordAnalysis.create` 回傳建立列（POST 走 enqueue-only → 202）、`findUnique` 回 null
 * （GET 受保護資料端點通過守衛後回 404，證明非 403）。
 */

const API_KEY = 'test-api-key'; // = .env.test API_KEY
const PASSWORD = 'correct-horse-battery';
const ALLOWED_ORIGIN = 'http://localhost:5173'; // = .env.test ALLOWED_ORIGINS
const FOREIGN_ORIGIN = 'http://evil.example';
const ANALYSES_PATH = '/api/v1/keyword-analyses';
const KEYWORDS_PATH = `/api/v1/keyword-analyses/${randomUUID()}/keywords`;

const VALID_BODY = {
  seeds: ['咖啡機', 'espresso machine'],
  geo: 'geoTargetConstants/2158',
  language: 'languageConstants/1018',
  mode: 'expand',
};

interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
}

/** 忠實 `prisma.user` 替身 + `keywordAnalysis`（create 回列、findUnique 回 null）。 */
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
    keywordAnalysis: {
      create: (args: { data: { id: string } }): Promise<{ id: string }> =>
        Promise.resolve(args.data),
      findUnique: (): Promise<null> => Promise.resolve(null),
      delete: (): Promise<null> => Promise.resolve(null),
    },
    snapshotRow: { findMany: (): Promise<never[]> => Promise.resolve([]) },
  };
}

describe('CSRF Origin check (e2e · TC-61 · FR-26)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await overrideBackgroundWorkers(
      Test.createTestingModule({ imports: [AppModule] }),
    )
      .overrideProvider(getQueueToken(KEYWORD_ANALYSIS_QUEUE))
      .useValue({ add: jest.fn().mockResolvedValue({ id: 'job-1' }), getJob: jest.fn() })
      .overrideProvider(BULL_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(KeywordAnalysisProcessor)
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

  /** 註冊 + 登入 → 回可續用的 `Cookie` header（帶 opaque sid）。 */
  async function registerAndLogin(email: string): Promise<string> {
    await request(server()).post('/api/v1/auth/register').send({ email, password: PASSWORD });
    const login = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    const raw = login.headers['set-cookie'] as unknown as string[] | string | undefined;
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const sid = arr.find((c) => c.startsWith('sid='));
    if (!sid) {
      throw new Error('login did not set a sid cookie');
    }
    return sid.split(';')[0];
  }

  it('AC-26.1: session-authed state-change with a foreign Origin → 403', async () => {
    const cookie = await registerAndLogin('csrf-foreign@example.com');
    const res = await request(server())
      .post(ANALYSES_PATH)
      .set('Cookie', cookie)
      .set('Origin', FOREIGN_ORIGIN)
      .send(VALID_BODY);
    expect(res.status).toBe(403);
  });

  it('AC-26.1: session-authed state-change with a whitelisted Origin → passes (not 403)', async () => {
    const cookie = await registerAndLogin('csrf-allowed@example.com');
    const res = await request(server())
      .post(ANALYSES_PATH)
      .set('Cookie', cookie)
      .set('Origin', ALLOWED_ORIGIN)
      .send(VALID_BODY);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(202); // 通過 CsrfGuard → enqueue-only 建立分析
  });

  it('AC-26.1: session-authed state-change missing both Origin and Referer → 403', async () => {
    const cookie = await registerAndLogin('csrf-missing@example.com');
    const res = await request(server()).post(ANALYSES_PATH).set('Cookie', cookie).send(VALID_BODY);
    expect(res.status).toBe(403);
  });

  it('AC-26.3: x-api-key state-change with a foreign Origin → NOT 403 (machine actor免 CSRF)', async () => {
    const res = await request(server())
      .post(ANALYSES_PATH)
      .set('x-api-key', API_KEY)
      .set('Origin', FOREIGN_ORIGIN)
      .send(VALID_BODY);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(202);
  });

  it('AC-26.4: session-authed GET with a foreign Origin → NOT 403 (safe method)', async () => {
    const cookie = await registerAndLogin('csrf-get@example.com');
    const res = await request(server())
      .get(KEYWORDS_PATH)
      .set('Cookie', cookie)
      .set('Origin', FOREIGN_ORIGIN);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404); // 通過守衛（找不到分析 → 404），未被 CSRF 擋下
  });
});
