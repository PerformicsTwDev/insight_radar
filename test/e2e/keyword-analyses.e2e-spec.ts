import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp } from 'src/bootstrap';
import { AppModule } from 'src/app.module';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';
import { PrismaService } from 'src/prisma';

const API_KEY = 'test-api-key'; // matches .env.test

/**
 * TC-21 / TC-28：`POST /keyword-analyses`。e2e 啟動完整 app 但以替身隔離外部資源：
 * 假 queue（`getQueueToken` override）、ioredis-mock（BULL_CONNECTION，免真 Redis + dangling handle）、
 * 假 prisma（無 DB），確保「POST 為 enqueue-only、零外部呼叫」可被驗。
 */
describe('POST /keyword-analyses (e2e, TC-21/TC-28)', () => {
  let app: INestApplication<App>;
  let queueAdd: jest.Mock;
  let prismaCreate: jest.Mock;

  beforeAll(async () => {
    queueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
    prismaCreate = jest.fn((args: { data: { id: string } }) => Promise.resolve(args.data));

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken(KEYWORD_ANALYSIS_QUEUE))
      .useValue({ add: queueAdd })
      // ioredis-mock so BullModule's forRoot connection has no real socket (no Jest hang).
      .overrideProvider(BULL_CONNECTION)
      .useValue({ quit: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(PrismaService)
      .useValue({
        keywordAnalysis: { create: prismaCreate, findUnique: jest.fn(), delete: jest.fn() },
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const validBody = {
    seeds: ['咖啡機', 'espresso machine'],
    geo: 'geoTargetConstants/2158',
    language: 'languageConstants/1018',
    mode: 'expand',
  };

  it('returns 202 + analysisId with a valid x-api-key', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses')
      .set('x-api-key', API_KEY)
      .send(validBody);

    expect(res.status).toBe(202);
    expect((res.body as { analysisId: string }).analysisId).toMatch(/^[0-9a-f-]{36}$/);
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing x-api-key with 401', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/keyword-analyses').send(validBody);

    expect(res.status).toBe(401);
  });

  it('rejects empty seeds with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses')
      .set('x-api-key', API_KEY)
      .send({ ...validBody, seeds: [] });

    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('rejects missing geo/language with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses')
      .set('x-api-key', API_KEY)
      .send({ seeds: ['x'], mode: 'expand' });

    expect(res.status).toBe(400);
  });

  it('rejects an invalid mode with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses')
      .set('x-api-key', API_KEY)
      .send({ ...validBody, mode: 'bogus' });

    expect(res.status).toBe(400);
  });

  it('accepts mode=exact and enqueues (TC-35 part)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses')
      .set('x-api-key', API_KEY)
      .send({ ...validBody, mode: 'exact' });

    expect(res.status).toBe(202);
  });

  it('rejects unknown fields with 400 (whitelist + forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses')
      .set('x-api-key', API_KEY)
      .send({ ...validBody, sneaky: 'nope' });

    expect(res.status).toBe(400);
  });

  it('is enqueue-only: POST makes zero external Ads/LLM calls (TC-28)', async () => {
    // The app graph has no real Ads/LLM clients wired into the POST path; the only
    // side effects are queue.add (mocked) and prisma.create (mocked). Assert the
    // request succeeds without ever resolving an external client.
    queueAdd.mockClear();
    prismaCreate.mockClear();

    const res = await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses')
      .set('x-api-key', API_KEY)
      .send({ ...validBody, seeds: ['unique-seed-for-enqueue-only'] });

    expect(res.status).toBe(202);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(prismaCreate).toHaveBeenCalledTimes(1);
  });
});
