import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from '../utils';

/**
 * TC-58 部分（NFR-14）：HTTP 邊緣 hardening——helmet 安全 header + body size limit。
 * `BODY_LIMIT_MB` 把 JSON body 上限自 express 預設 100kb **提高**（exact 模式大 seeds 需要），逾此 → 413。
 * **prod 預設 5MB（Design §14）**；本 e2e 走 `.env.test` 的 `BODY_LIMIT_MB=1`（刻意收窄，讓 ~1.5MB 即逾限，
 * 免用 >5MB 大 payload）。`~500kb` 案（> 100kb 預設、< 1MB 測試上限）驗「限額確實提高」（非仍是 100kb 預設）；
 * `~1.5MB` 案驗「逾上限被擋」→ 413（由 HttpExceptionFilter 尊重 body-parser 的 http-errors 413，不遮成 500）。
 */
const API_KEY = 'test-api-key';
const UNDER = 'x'.repeat(500 * 1024); // ~500kb：> 100kb 預設、< 1MB 上限
const OVER = 'x'.repeat(1.5 * 1024 * 1024); // ~1.5MB：> 1MB 上限

describe('HTTP hardening: helmet + body limit (e2e · TC-58 部分 · NFR-14)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('helmet 安全 header 存在（x-content-type-options: nosniff）', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('body 逾 BODY_LIMIT_MB → 413', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses')
      .set('x-api-key', API_KEY)
      .set('content-type', 'application/json')
      .send(JSON.stringify({ seeds: [OVER], geo: 'TW', language: 'zh-TW' }));
    expect(res.status).toBe(413);
  });

  it('body 在 BODY_LIMIT_MB 內（> 100kb 預設）→ 非 413（限額已自 100kb 提高、抵達 handler）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses')
      .set('x-api-key', API_KEY)
      .send({ seeds: [UNDER], geo: 'TW', language: 'zh-TW' });
    expect(res.status).not.toBe(413);
  });
});
