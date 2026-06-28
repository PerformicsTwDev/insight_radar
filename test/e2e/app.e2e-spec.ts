import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from '../utils';

describe('App bootstrap (e2e harness)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // GET /health 的 200 + 內容驗證移到 integration（terminus 探真實 DB；見 test/integration/health.int-spec.ts）。
  // e2e 僅驗 app 啟動（lazy Prisma，無 DB 也能 boot）+ 前綴/錯誤格式（不觸發 DB 探針）。

  it('applies the /api/v1 global prefix with /health excluded (GET /api/v1/health → 404)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');

    expect(res.status).toBe(404);
  });

  it('formats errors via the global HttpExceptionFilter (404 → uniform ErrorResponse)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist');
    const body = res.body as { statusCode: number; code: string; path: string; timestamp: string };

    expect(res.status).toBe(404);
    expect(body).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      path: '/api/v1/does-not-exist',
    });
    expect(typeof body.timestamp).toBe('string');
  });
});
