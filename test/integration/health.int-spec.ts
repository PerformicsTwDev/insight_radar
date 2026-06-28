import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from '../utils';

describe('GET /health (integration · terminus, Testcontainers Postgres)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is public (no x-api-key) and reports db + cache up → 200 (TC-25)', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    const body = res.body as {
      status?: string;
      info?: Record<string, { status: string }>;
      details?: Record<string, { status: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.info?.database?.status).toBe('up');
    expect(body.info?.cache?.status).toBe('up');
  });
});
