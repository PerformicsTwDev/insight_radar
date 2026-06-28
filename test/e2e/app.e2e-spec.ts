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

  it('boots the full Nest app and serves GET /health → 200 { status: ok }', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

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
