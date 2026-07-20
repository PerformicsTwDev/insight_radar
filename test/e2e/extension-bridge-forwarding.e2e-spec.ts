import { randomUUID } from 'node:crypto';
import { overrideBackgroundWorkers } from './helpers/background-workers';
import type { INestApplication } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { SessionService } from 'src/auth';
import { configureApp } from 'src/bootstrap';
import { isFeatureAvailable, negotiateCapabilities } from 'src/captures/capability-negotiation';
import type { CapturePlatform, CaptureChannel } from 'src/captures/dto/capture-ingest.dto';
import { ingestConfig } from 'src/config/ingest.config';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { PrismaService } from 'src/prisma';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION } from 'src/queue/queue.constants';

/**
 * TC-94（前端轉發鏈 e2e，NFR-21 / AC-51.4 · FR-36 owner scope）：模擬 **extension-primary v1 橋接**
 * （ADR-0007 / Design §18.1:1910）——extension B 橋接 `window.postMessage({type:'*-from-extension', …})` →
 * **前端收訊 → 能力協商 gating → 轉 `POST /captures`（session cookie 天然帶認證）**。
 *
 * extension 端不在本 repo（`web-insight-capture-wxt`，外部協調項 T13.6）——故 bridge 訊息以 **fixture 模擬其形狀**
 * （research 三份的 `threads-batch-data-from-extension` / `google-serp-data-from-extension` /
 * `chatgpt-data-from-extension`），前端轉發邏輯（bridge envelope → captures DTO）以本檔 `forwardBridgeMessage`
 * helper 模擬（真實消費端在 frontend repo）。**能力協商為真**：用 `src/captures/capability-negotiation` 的純函式 +
 * `EXTENSION_BRIDGE_REQUIRED_FEATURES` config——`EXTERNAL_PONG.features[]` 未回報之渠道 → not-available → gating
 * 不轉發（不硬崩、不編造）。
 *
 * DB 以「忠實 Prisma 替身」（e2e 無 Testcontainers，同 captures.e2e-spec 先例）：只驗轉發鏈 + 認證 + owner 歸屬 +
 * 落庫形狀 + gating；真 DB 去重由 capture-idempotency.int-spec 覆蓋。
 */

const OWNER = randomUUID();
const ORIGIN = 'http://localhost:5173'; // .env.test ALLOWED_ORIGINS（CSRF 白名單）

// research-confirmed：extension B 橋接目前 EXTERNAL_PONG 只回報這三個 feature。
const PONG_FEATURES_CONFIRMED = ['threadsSearch', 'googleSerp', 'chatGpt'];

interface CaptureRow {
  id: string;
  ownerId: string | null;
  source: string;
  schemaVersion: string;
  channel: string | null;
  platform: string | null;
  contentHash: string;
  payload: unknown;
  capturedAt: Date;
}
interface UserRow {
  id: string;
  email: string;
}

/** 忠實 `prisma` 替身（同 captures.e2e-spec）：append-only createMany + findMany 回讀 + user 投影。 */
function makeFakeDb(users: UserRow[]) {
  const captures: CaptureRow[] = [];
  const byHash = new Map<string, CaptureRow>();
  const userMap = new Map(users.map((u) => [u.id, u]));
  return {
    captures,
    reset(): void {
      captures.length = 0;
      byHash.clear();
    },
    user: {
      findUnique: ({ where }: { where: { id?: string } }): Promise<UserRow | null> =>
        Promise.resolve(where.id ? (userMap.get(where.id) ?? null) : null),
    },
    capture: {
      createMany: ({
        data,
        skipDuplicates,
      }: {
        data: CaptureRow[];
        skipDuplicates?: boolean;
      }): Promise<{ count: number }> => {
        let count = 0;
        for (const row of data) {
          if (byHash.has(row.contentHash)) {
            if (skipDuplicates) continue;
            const err = new Error('Unique constraint failed on the fields: (`content_hash`)');
            return Promise.reject(Object.assign(err, { code: 'P2002' }));
          }
          const stored = { ...row };
          captures.push(stored);
          byHash.set(stored.contentHash, stored);
          count += 1;
        }
        return Promise.resolve({ count });
      },
      findMany: ({
        where,
      }: {
        where?: { contentHash?: { in?: string[] } };
      }): Promise<Array<{ id: string; contentHash: string }>> => {
        const hashes = where?.contentHash?.in ?? [];
        return Promise.resolve(
          hashes
            .map((h) => byHash.get(h))
            .filter((r): r is CaptureRow => r !== undefined)
            .map((r) => ({ id: r.id, contentHash: r.contentHash })),
        );
      },
    },
  };
}

// —— extension bridge 訊息形狀（fixture，模擬 window.postMessage `*-from-extension`）——
interface BridgeMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * 前端轉發路由：bridge 訊息 `type` → { 對應能力 feature, source/channel/platform, 抽 items }。
 * 記錄 v1 橋接契約（Design §18.1:1910）；真實前端在 `web-insight-capture-wxt` 消費端實作等價轉發。
 */
interface BridgeRoute {
  feature: string; // EXTERNAL_PONG.features[] 對應能力（協商 gating 依據）
  channel?: CaptureChannel;
  platform?: CapturePlatform;
  extractItems: (msg: BridgeMessage) => Record<string, unknown>[];
}

const BRIDGE_ROUTES: Record<string, BridgeRoute> = {
  'chatgpt-data-from-extension': {
    feature: 'chatGpt',
    channel: 'chatGpt',
    extractItems: (m) => [m.data as Record<string, unknown>],
  },
  'threads-batch-data-from-extension': {
    feature: 'threadsSearch',
    platform: 'threads',
    extractItems: (m) => m.posts as Record<string, unknown>[],
  },
  'google-serp-data-from-extension': {
    feature: 'googleSerp',
    channel: 'googleSearch',
    extractItems: (m) => [{ keyword: m.keyword, ...(m.data as Record<string, unknown>) }],
  },
  // Custom Domain readability 兜底（擴充項；extension 端未回報 → gating not-available）。
  'readability-data-from-extension': {
    feature: 'readability',
    platform: 'customDomain',
    extractItems: (m) => [m.article as Record<string, unknown>],
  },
};

describe('TC-94: extension bridge forwarding chain (e2e · NFR-21 · AC-51.4 · FR-36)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof makeFakeDb>;
  let cookie: string;
  let requiredFeatures: string[];

  beforeAll(async () => {
    db = makeFakeDb([{ id: OWNER, email: 'owner@example.com' }]);
    const moduleRef = await overrideBackgroundWorkers(
      Test.createTestingModule({ imports: [AppModule] }),
    )
      .overrideProvider(BULL_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(KeywordAnalysisProcessor)
      .useValue({})
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    // 能力協商基準取自**真** config（EXTENSION_BRIDGE_REQUIRED_FEATURES 接線；.env.test 已設）。
    const config = app.get<ConfigType<typeof ingestConfig>>(ingestConfig.KEY);
    requiredFeatures = config.bridgeRequiredFeatures;

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

  /**
   * 前端轉發（模擬）：收 bridge 訊息 → 能力協商 gating → 若該渠道 feature available 則轉 `POST /captures`
   * （session cookie）。未回報之渠道 → not-available → **不轉發**（gating、不編造）。回傳是否轉發 + HTTP 回應。
   */
  async function forwardBridgeMessage(
    msg: BridgeMessage,
    pongFeatures: string[],
    opts: { withCookie?: boolean } = { withCookie: true },
  ): Promise<{ forwarded: boolean; status?: number; body?: unknown }> {
    const route = BRIDGE_ROUTES[msg.type];
    if (!route) {
      return { forwarded: false }; // 未知 bridge 型別 → 不轉發（不猜形狀）
    }
    const negotiation = negotiateCapabilities(pongFeatures, requiredFeatures);
    if (!isFeatureAvailable(negotiation, route.feature)) {
      return { forwarded: false }; // gating：未回報該能力 → not-available → 不轉發
    }
    const dto = {
      source: 'extension',
      ...(route.channel ? { channel: route.channel } : {}),
      ...(route.platform ? { platform: route.platform } : {}),
      schemaVersion: 'v1',
      items: route.extractItems(msg),
    };
    let req = request(server()).post(url).set('Origin', ORIGIN);
    if (opts.withCookie) {
      req = req.set('Cookie', cookie);
    }
    const res = await req.send(dto);
    return { forwarded: true, status: res.status, body: res.body };
  }

  // —— bridge 訊息 fixtures（模擬 extension window.postMessage 形狀）——
  const chatGptMsg: BridgeMessage = {
    type: 'chatgpt-data-from-extension',
    prompt: 'best ergonomic office chair 2025',
    data: {
      query: 'best ergonomic office chair 2025',
      answer: 'The Herman Miller Aeron and Steelcase Leap are top picks for 2025.',
      references: [{ title: 'Aeron Review', link: 'https://example.com/aeron' }],
    },
  };
  const threadsMsg: BridgeMessage = {
    type: 'threads-batch-data-from-extension',
    posts: [
      {
        author: 'coffee_lover_tw',
        content: '剛入手 Breville 870，拉花超順手！',
        permalink: 'https://www.threads.net/@coffee_lover_tw/post/C1a2b3c4',
        likesCount: '8K',
        commentsCount: 128,
      },
      {
        author: 'bean_hunter',
        content: '請問淺焙推薦？',
        permalink: 'https://www.threads.net/@bean_hunter/post/D9z8y7x6',
        likesCount: 42,
      },
    ],
  };
  const googleSerpMsg: BridgeMessage = {
    type: 'google-serp-data-from-extension',
    keyword: 'ergonomic chair',
    data: { naturalSearchResult: [{ title: 'Best chairs', link: 'https://example.com/x' }] },
  };
  // Custom Domain readability（擴充渠道，extension 端尚未回報 feature `readability`）。
  const readabilityMsg: BridgeMessage = {
    type: 'readability-data-from-extension',
    article: { url: 'https://blog.example.com/post', content: 'Long-form article body...' },
  };

  describe('available 渠道 → 轉發 → 202 落庫（extension → 前端 → POST /captures）', () => {
    it('chatgpt-data-from-extension（feature chatGpt 已回報）→ 轉發 202；落 channel=chatGpt', async () => {
      const out = await forwardBridgeMessage(chatGptMsg, PONG_FEATURES_CONFIRMED);
      expect(out.forwarded).toBe(true);
      expect(out.status).toBe(202);
      expect(db.captures).toHaveLength(1);
      expect(db.captures[0].source).toBe('extension');
      expect(db.captures[0].channel).toBe('chatGpt');
      expect(db.captures[0].platform).toBeNull();
      // raw append-only：payload 保留 bridge 抽出的 item。
      expect(db.captures[0].payload).toEqual(chatGptMsg.data);
    });

    it('threads-batch-data-from-extension（feature threadsSearch）→ 轉發 202；每貼文一列 platform=threads', async () => {
      const out = await forwardBridgeMessage(threadsMsg, PONG_FEATURES_CONFIRMED);
      expect(out.forwarded).toBe(true);
      expect(out.status).toBe(202);
      expect(db.captures).toHaveLength(2);
      expect(db.captures.every((c) => c.platform === 'threads' && c.channel === null)).toBe(true);
    });

    it('google-serp-data-from-extension（feature googleSerp）→ 轉發 202；落 channel=googleSearch', async () => {
      const out = await forwardBridgeMessage(googleSerpMsg, PONG_FEATURES_CONFIRMED);
      expect(out.forwarded).toBe(true);
      expect(out.status).toBe(202);
      expect(db.captures).toHaveLength(1);
      expect(db.captures[0].channel).toBe('googleSearch');
    });
  });

  describe('未回報渠道 → not-available → gating（不轉發、不編造）', () => {
    it('readability-data-from-extension（extension 未回報 feature readability）→ 不轉發；零落庫', async () => {
      // 前置：readability 確在 required 基準內，但不在 PONG 回報 → 協商 not-available。
      expect(requiredFeatures).toContain('readability');
      const negotiation = negotiateCapabilities(PONG_FEATURES_CONFIRMED, requiredFeatures);
      expect(negotiation.statuses.readability).toBe('not-available');

      const out = await forwardBridgeMessage(readabilityMsg, PONG_FEATURES_CONFIRMED);
      expect(out.forwarded).toBe(false);
      expect(out.status).toBeUndefined();
      expect(db.captures).toHaveLength(0); // gating：邊界擋下、未打端點、未編造資料
    });

    it('extension 回報擴充後 readability → 同訊息改為可轉發 202（協商放行）', async () => {
      const out = await forwardBridgeMessage(readabilityMsg, [
        ...PONG_FEATURES_CONFIRMED,
        'readability',
      ]);
      expect(out.forwarded).toBe(true);
      expect(out.status).toBe(202);
      expect(db.captures).toHaveLength(1);
      expect(db.captures[0].platform).toBe('customDomain');
    });
  });

  describe('session cookie 認證路徑（AC-36.4 · FR-27）', () => {
    it('轉發帶 session cookie → owner 歸屬 = user.id', async () => {
      await forwardBridgeMessage(chatGptMsg, PONG_FEATURES_CONFIRMED);
      expect(db.captures.every((c) => c.ownerId === OWNER)).toBe(true);
    });

    it('轉發缺 session cookie（未登入前端）→ 401；零落庫', async () => {
      const out = await forwardBridgeMessage(chatGptMsg, PONG_FEATURES_CONFIRMED, {
        withCookie: false,
      });
      expect(out.forwarded).toBe(true); // gating 放行（feature available），但認證失敗
      expect(out.status).toBe(401);
      expect(db.captures).toHaveLength(0);
    });
  });
});
