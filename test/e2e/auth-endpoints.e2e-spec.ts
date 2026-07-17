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
import { authConfig, type AuthConfig } from 'src/config/auth.config';
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
 * TC-59（FR-24，AC-24.1~24.6）：register/login/logout/me + session cookie。
 * - register：argon2id 雜湊落 `User.passwordHash`（明文/hash **不入回應**）；email 重複→409；弱格式→400。
 * - login：驗證成功設 **httpOnly + SameSite=Lax + Secure + Path=/** cookie（值=opaque sid）+ Redis session；
 *   body 只回 `{user:{id,email}}`（**不**含 password/hash/sid）。
 * - AC-24.3 反枚舉：錯誤密碼與不存在 email **同回 401、同一通用訊息**（皆執行一次 argon2 verify、耗時相近）。
 * - logout：撤銷 Redis session（後續同 cookie 視為未認證）+ 清 cookie。
 * - me：有效 session→`{id,email}`；無/失效 session→401（真理在 Redis session，DB 有 User 不放行，AC-24.6）。
 *
 * DB 以「忠實 Prisma 替身」（e2e project 無 Testcontainers；同 history-list.e2e 先例）——`email` 唯一，
 * 重複 create 拋真實 P2002。Redis/session 走真 `SessionService` + 記憶體 Keyv（NODE_ENV=test）+ 真 argon2。
 * `authConfig.KEY` 覆寫 `cookieSecure:true`（.env.test 為 http→false）以忠實斷言 Secure flag（S6/AC-24.2）。
 */

interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
}

/** 忠實 `prisma.user` 替身：`email` 唯一（重複 create → P2002）；findUnique 支援 by email / by id + select 投影。 */
function makeFakeUserDb() {
  const rows = new Map<string, UserRow>(); // by id
  let nextCreateError: Error | null = null; // 一次性注入：模擬非 P2002 的 DB 錯誤
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
    reset: (): void => {
      rows.clear();
      nextCreateError = null;
    },
    failNextCreate: (error: Error): void => {
      nextCreateError = error;
    },
    user: {
      create: ({
        data,
        select,
      }: {
        data: { email: string; passwordHash: string };
        select?: Record<string, boolean>;
      }): Promise<Partial<UserRow>> => {
        if (nextCreateError) {
          const err = nextCreateError;
          nextCreateError = null;
          return Promise.reject(err);
        }
        if (byEmail(data.email)) {
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: 'test',
              meta: { target: ['email'] },
            }),
          );
        }
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
  };
}

const TEST_AUTH_CONFIG: AuthConfig = {
  argon2MemoryKib: 19456,
  argon2TimeCost: 2,
  argon2Parallelism: 1,
  minPasswordLen: 10,
  sessionSecret: 'test-session-secret-0123456789',
  sessionTtlMs: 604800000,
  cookieName: 'sid',
  cookieSecure: true, // ★ 覆蓋 .env.test（false）：斷言 Secure flag（S6/AC-24.2）
  cookieSameSite: 'lax',
};

const PASSWORD = 'correct-horse-battery';

/** 從 Set-Cookie 陣列取 sid cookie 字串。 */
function setCookieValue(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const found = arr.find((c) => c.startsWith('sid='));
  if (!found) {
    throw new Error('no sid Set-Cookie');
  }
  return found;
}

/** 'sid=abc; Path=/; HttpOnly' → 'sid=abc'（可回傳給後續請求的 Cookie header）。 */
function cookieHeader(setCookie: string): string {
  return setCookie.split(';')[0];
}

/** 'sid=abc; ...' → 'abc'（opaque sid 值）。 */
function sidOf(setCookie: string): string {
  return cookieHeader(setCookie).slice('sid='.length);
}

describe('auth endpoints (e2e · TC-59 · FR-24)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof makeFakeUserDb>;
  let sessions: SessionService;

  beforeAll(async () => {
    db = makeFakeUserDb();
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
      .overrideProvider(authConfig.KEY)
      .useValue(TEST_AUTH_CONFIG)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sessions = app.get(SessionService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    db.reset();
  });

  const server = (): App => app.getHttpServer();

  async function register(email: string): Promise<request.Response> {
    return request(server()).post('/api/v1/auth/register').send({ email, password: PASSWORD });
  }

  /** 註冊 + 登入，回傳可續用的 Cookie header 與 sid。 */
  async function registerAndLogin(
    email: string,
  ): Promise<{ cookie: string; sid: string; userId: string }> {
    const reg = await register(email);
    expect(reg.status).toBe(201);
    const userId = (reg.body as { user: { id: string } }).user.id;
    const login = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    const setCookie = setCookieValue(login);
    return { cookie: cookieHeader(setCookie), sid: sidOf(setCookie), userId };
  }

  describe('POST /auth/register (AC-24.1)', () => {
    it('建立帳號 → 201 + { user:{id,email} }，不回 password/hash', async () => {
      const res = await register('alice@example.com');
      expect(res.status).toBe(201);
      const body = res.body as { user: { id: string; email: string } };
      expect(body.user.email).toBe('alice@example.com');
      expect(typeof body.user.id).toBe('string');
      expect(Object.keys(body.user).sort()).toEqual(['email', 'id']);
      // hash/明文絕不外洩
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain(PASSWORD);
      expect(serialized).not.toContain('argon2');
      expect(serialized.toLowerCase()).not.toContain('passwordhash');
    });

    it('email 重複 → 409（P2002）', async () => {
      await register('dup@example.com');
      const res = await register('dup@example.com');
      expect(res.status).toBe(409);
    });

    it('弱密碼（< 10）→ 400', async () => {
      const res = await request(server())
        .post('/api/v1/auth/register')
        .send({ email: 'weak@example.com', password: 'short' });
      expect(res.status).toBe(400);
    });

    it('非 email → 400', async () => {
      const res = await request(server())
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: PASSWORD });
      expect(res.status).toBe(400);
    });

    it('非 P2002 的 DB 錯誤 → 不吞、原樣上拋（500，非 409）', async () => {
      // 只有 unique 違反（P2002）才映射 409；其餘 DB 錯誤不得被誤判為「重複」——原樣上拋、由全域 filter 轉 500。
      db.failNextCreate(new Error('connection reset'));
      const res = await request(server())
        .post('/api/v1/auth/register')
        .send({ email: 'boom@example.com', password: PASSWORD });
      expect(res.status).toBe(500);
    });
  });

  describe('POST /auth/login (AC-24.2/24.3)', () => {
    it('登入成功 → 200 + httpOnly/SameSite=Lax/Secure/Path=/ cookie + { user:{id,email} }（無 sid/hash）', async () => {
      await register('bob@example.com');
      const res = await request(server())
        .post('/api/v1/auth/login')
        .send({ email: 'bob@example.com', password: PASSWORD });
      expect(res.status).toBe(200);

      const setCookie = setCookieValue(res);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('Path=/');

      const body = res.body as { user: { id: string; email: string } };
      expect(body.user.email).toBe('bob@example.com');
      expect(Object.keys(body.user).sort()).toEqual(['email', 'id']);
      // sid 只在 cookie，body 不得洩漏 sid/hash
      const sid = sidOf(setCookie);
      expect(JSON.stringify(res.body)).not.toContain(sid);
      expect(JSON.stringify(res.body).toLowerCase()).not.toContain('passwordhash');
    });

    it('錯誤密碼 與 不存在 email → 皆 401 且同一通用訊息（反枚舉，AC-24.3）', async () => {
      await register('carol@example.com');
      const wrongPw = await request(server())
        .post('/api/v1/auth/login')
        .send({ email: 'carol@example.com', password: 'wrong-password-xyz' });
      const unknownEmail = await request(server())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: PASSWORD });

      expect(wrongPw.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      const msgA = (wrongPw.body as { message: string }).message;
      const msgB = (unknownEmail.body as { message: string }).message;
      expect(msgA).toBe(msgB); // 不區分：同一訊息
      expect(wrongPw.headers['set-cookie']).toBeUndefined(); // 失敗不設 session cookie
    });
  });

  describe('GET /auth/me (AC-24.5/24.6)', () => {
    it('有效 session → { id, email }', async () => {
      const { cookie, userId } = await registerAndLogin('dave@example.com');
      const res = await request(server()).get('/api/v1/auth/me').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: userId, email: 'dave@example.com' });
    });

    it('無 cookie → 401', async () => {
      const res = await request(server()).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('AC-24.6：session 已失效（Redis TTL/撤銷）→ 401，DB 有 User 也不放行', async () => {
      const { cookie, sid } = await registerAndLogin('erin@example.com');
      await sessions.revoke(sid); // 模擬 TTL 到期（Redis key 消失）
      const res = await request(server()).get('/api/v1/auth/me').set('Cookie', cookie);
      expect(res.status).toBe(401); // User 仍在 DB，但 session 已失效 → 未認證
    });

    it('session 有效但對應 User 不存在 → 401（真理在 session，防越權讀）', async () => {
      const sid = await sessions.create('99999999-9999-9999-9999-999999999999');
      const res = await request(server()).get('/api/v1/auth/me').set('Cookie', `sid=${sid}`);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout (AC-24.4)', () => {
    it('撤銷 session + 清 cookie；後續同 cookie 的 /me → 401', async () => {
      const { cookie } = await registerAndLogin('frank@example.com');

      // logout 現由 CsrfGuard 保護（session 狀態變更）→ 需同源 Origin（瀏覽器登出必帶）；白名單＝.env.test。
      const out = await request(server())
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:5173');
      expect(out.status).toBe(200);
      const cleared = setCookieValue(out);
      expect(cleared).toContain('sid=;'); // 值清空
      expect(cleared).toContain('Expires=Thu, 01 Jan 1970'); // 過期

      const me = await request(server()).get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me.status).toBe(401); // session 已撤銷
    });

    it('無有效 session 的 logout → 401', async () => {
      const res = await request(server()).post('/api/v1/auth/logout');
      expect(res.status).toBe(401);
    });

    it('跨站 Origin 的 session logout → 403（防跨站強制登出 CSRF，AC-26.1）', async () => {
      const { cookie } = await registerAndLogin('grace@example.com');
      const res = await request(server())
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie)
        .set('Origin', 'http://evil.example');
      expect(res.status).toBe(403); // CsrfGuard 擋下；logout 非 @Public，session 狀態變更受 CSRF 保護
    });
  });

  // —— T10.7 安全複驗（NFR-15）：把端到端 session 安全不變式一次串起（Design §17.5 S6~S8）——
  describe('security matrix：端到端 session 安全複驗 (T10.7, NFR-15)', () => {
    it('register→login(cookie flags)→me→跨站 CSRF 403→同源 logout 撤銷→同 cookie 再 me 401', async () => {
      // 1) register + login：cookie flags = httpOnly + SameSite=Lax + Secure + Path=/（S6/AC-24.2）。
      const reg = await register('mallory@example.com');
      expect(reg.status).toBe(201);
      const login = await request(server())
        .post('/api/v1/auth/login')
        .send({ email: 'mallory@example.com', password: PASSWORD });
      expect(login.status).toBe(200);
      const setCookie = setCookieValue(login);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      expect(setCookie).toMatch(/Secure/i);
      expect(setCookie).toMatch(/Path=\//i);
      // body 不含 password / opaque sid（S7/NFR-5）。
      const loginBody = JSON.stringify(login.body);
      expect(loginBody).not.toContain(PASSWORD);
      expect(loginBody).not.toContain(sidOf(setCookie));
      const cookie = cookieHeader(setCookie);

      // 2) me（有效 session）→ { id, email }，無 hash。
      const me1 = await request(server()).get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me1.status).toBe(200);
      expect(Object.keys(me1.body as object).sort()).toEqual(['email', 'id']);

      // 3) 跨站 Origin 的 session 狀態變更（logout）→ 403（CSRF，AC-26.1；SameSite=Lax 之上第二層）。
      const csrf = await request(server())
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie)
        .set('Origin', 'http://evil.example');
      expect(csrf.status).toBe(403);

      // 4) 同源 logout → 撤銷 Redis session + 清 cookie。
      const logout = await request(server())
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:5173');
      expect(logout.status).toBe(200);
      expect(setCookieValue(logout)).toContain('sid=;'); // 清空

      // 5) 同 cookie 再 me → 401（撤銷即失效，真理在 Redis session，AC-24.6）。
      const me2 = await request(server()).get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me2.status).toBe(401);
    });
  });
});
