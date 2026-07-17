import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp } from 'src/bootstrap';
import { AppModule } from 'src/app.module';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import {
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from 'src/queue/topic-job-events.constants';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';
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
  let queueGetJob: jest.Mock;
  let prismaCreate: jest.Mock;
  let prismaFindUnique: jest.Mock;

  beforeAll(async () => {
    queueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
    queueGetJob = jest.fn();
    prismaCreate = jest.fn((args: { data: { id: string } }) => Promise.resolve(args.data));
    prismaFindUnique = jest.fn();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken(KEYWORD_ANALYSIS_QUEUE))
      .useValue({ add: queueAdd, getJob: queueGetJob })
      // Real in-memory ioredis-mock: the @Processor's auto-created BullMQ Worker needs a
      // usable client (duplicate()/blocking cmds). A bare {quit} stub makes the Worker fall
      // back to a real Redis (ECONNREFUSED on CI). ioredis-mock keeps it fully in-memory.
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
      .overrideProvider(PrismaService)
      .useValue({
        keywordAnalysis: { create: prismaCreate, findUnique: prismaFindUnique, delete: jest.fn() },
      })
      // Stub the processor so its WorkerHost doesn't spin up a real BullMQ Worker
      // (this is an HTTP-layer e2e; worker behavior is covered by the processor unit test).
      .overrideProvider(KeywordAnalysisProcessor)
      .useValue({})
      .overrideProvider(TopicClusterProcessor)
      .useValue({})
      .overrideProvider(TrackingRefreshProcessor)
      .useValue({})
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
    // The app graph wires NO Ads/LLM provider into the POST path (verified: only
    // queue.add + prisma.create + cache fire). Until the worker/processor lands
    // (T3.5) there is no external client to spy; the call-count=0 is structural.
    // Re-add an explicit Ads/LLM spy once those clients exist on the worker side.
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

  it('responds well within the enqueue-only latency budget (TC-28, p95<300ms)', async () => {
    // Coarse single-request guard for the NFR-1 budget; pure enqueue (mocked I/O)
    // should be far under 300ms. Real p95 load profiling is deferred to a perf test.
    const start = process.hrtime.bigint();
    const res = await request(app.getHttpServer())
      .post('/api/v1/keyword-analyses')
      .set('x-api-key', API_KEY)
      .send({ ...validBody, seeds: ['latency-budget-seed'] });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

    expect(res.status).toBe(202);
    expect(elapsedMs).toBeLessThan(300);
  });

  describe('GET /keyword-analyses/:id (TC-22) — DB source of truth', () => {
    it('returns 200 with status/progress/result for a running job', async () => {
      prismaFindUnique.mockResolvedValueOnce({
        id: 'some-id',
        status: 'running',
        progress: { phase: 'intent', percent: 72, expanded: 1980, labeled: 1420, total: 1980 },
        resultSnapshot: null,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/keyword-analyses/some-id')
        .set('x-api-key', API_KEY);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'running',
        progress: { phase: 'intent', percent: 72, expanded: 1980, labeled: 1420, total: 1980 },
        result: { resultSnapshotId: null, count: null },
        // T6.8：running（無 snapshot）→ keyword_metrics running；serp/topics compute 未實作（AC-14.7）。
        features: {
          keyword_metrics: { status: 'running' },
          serp: { status: 'not_generated' },
          topics: { status: 'not_generated' },
          journey: { status: 'not_generated' },
        },
      });
    });

    it('returns the completed result snapshot id + count', async () => {
      prismaFindUnique.mockResolvedValueOnce({
        id: 'some-id',
        status: 'completed',
        progress: { phase: 'done', percent: 100 },
        resultSnapshot: { id: 'snap-9', keywordCount: 1980 },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/keyword-analyses/some-id')
        .set('x-api-key', API_KEY);

      expect(res.status).toBe(200);
      expect((res.body as { result: unknown }).result).toEqual({
        resultSnapshotId: 'snap-9',
        count: 1980,
      });
    });

    it('surfaces a partial status (queue state cannot express it)', async () => {
      prismaFindUnique.mockResolvedValueOnce({
        id: 'some-id',
        status: 'partial',
        progress: { phase: 'intent', percent: 100 },
        resultSnapshot: { id: 'snap-p', keywordCount: 800 },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/keyword-analyses/some-id')
        .set('x-api-key', API_KEY);

      expect(res.status).toBe(200);
      expect((res.body as { status: string }).status).toBe('partial');
    });

    it('returns 404 for an unknown analysisId', async () => {
      prismaFindUnique.mockResolvedValueOnce(null);

      const res = await request(app.getHttpServer())
        .get('/api/v1/keyword-analyses/missing')
        .set('x-api-key', API_KEY);

      expect(res.status).toBe(404);
      expect((res.body as { code: string }).code).toBe('NOT_FOUND');
    });

    it('requires x-api-key (401 without)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/keyword-analyses/some-id');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /keyword-analyses/:id/stream (TC-18, SSE) — §6.3 wire format over HTTP', () => {
    it('emits an "event: completed" SSE frame with {resultSnapshotId,count} for a finished job', async () => {
      prismaFindUnique.mockResolvedValueOnce({
        id: 'done',
        status: 'completed',
        progress: { phase: 'done', percent: 100 },
        resultSnapshot: { id: 'snap-7', keywordCount: 1980 },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/keyword-analyses/done/stream')
        .set('x-api-key', API_KEY);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      // 終態短路 → 單筆 §6.3 completed 事件 + complete（連線收尾）。
      expect(res.text).toContain('event: completed');
      expect(res.text).toContain('"resultSnapshotId":"snap-7"');
      expect(res.text).toContain('"count":1980');
    });

    it('requires x-api-key (401 without)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/keyword-analyses/done/stream');

      expect(res.status).toBe(401);
    });
  });
});
