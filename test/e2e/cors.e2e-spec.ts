import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from '../utils';

/**
 * TC-58 部分（NFR-14）：CORS 白名單 + credentialed preflight。
 * `ALLOWED_ORIGINS` 由 `.env.test`（`http://localhost:5173`）提供；`enableCors` 於 `configureApp`
 * （`src/bootstrap.ts`，與 `main.ts`/e2e harness 共用，保證正式與測試不漂移）。
 * `credentials:true` 為 M10 session cookie 預備 → origin 必為反射式白名單（不可萬用 `*`）。
 */
const ALLOWED = 'http://localhost:5173';
const DISALLOWED = 'http://evil.example';

describe('CORS preflight (e2e · TC-58 部分 · NFR-14)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('白名單 origin 的 credentialed preflight → 回對應 Access-Control-Allow-Origin + Allow-Credentials', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/keyword-analyses')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-api-key');

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    // credentials 模式必要條件：反射式 origin，非萬用 '*'。
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('非白名單 origin 的 preflight → 不回 Access-Control-Allow-Origin（被擋）', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/keyword-analyses')
      .set('Origin', DISALLOWED)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
