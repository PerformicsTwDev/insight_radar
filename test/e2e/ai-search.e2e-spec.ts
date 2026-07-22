import { getQueueToken } from '@nestjs/bullmq';
import { overrideBackgroundWorkers } from './helpers/background-workers';
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
import { AI_SEARCH_QUEUE, BULL_CONNECTION } from 'src/queue/queue.constants';
import { SERP_AI_PROVIDER } from 'src/serp/serpapi-ai.types';

const API_KEY = 'test-api-key'; // matches .env.test
const RID = '33333333-3333-3333-3333-333333333333'; // valid UUID (:id 經 ParseUUIDPipe)

/**
 * TC-77 (T14.6 · FR-41/AC-41.x): `POST /ai-search-analyses` 為 **enqueue-only、零外部呼叫**（p95<300ms）。
 * 以替身隔離：假 ai-search queue（getQueueToken）、ioredis-mock、SERP_AI_PROVIDER spy、假 prisma → 驗 202 只入列、
 * idempotency 命中回同 jobId、GET 狀態、未知→404、SSE 未知回空串流（不 hang）、DTO 400、401 無 key。合流/partial 於
 * integration（Testcontainers）驗（processor 於此 stub）。
 */
describe('POST/GET/SSE /ai-search-analyses (e2e, TC-77)', () => {
  let app: INestApplication<App>;
  let queueAdd: jest.Mock;
  let runFindUnique: jest.Mock;
  let runCreate: jest.Mock<Promise<{ id: string }>, [{ data: Record<string, unknown> }]>;
  let analysisFindUnique: jest.Mock; // T15.8a: findAnalysisOwner (owner-verify the linked analysis)
  let serpFetchAiOverviews: jest.Mock;
  let serpFetchAiModes: jest.Mock;
  let serpFetchBingCopilot: jest.Mock;

  /** idempotency lookup (where.idempotencyKey) vs by-id lookup (where.id) share prisma.aiSearchRun.findUnique. */
  let idempotencyRow: unknown; // createRun's findUnique({where:{idempotencyKey}})
  let byIdRow: unknown; // findById's findUnique({where:{id}})
  let analysisRow: unknown; // keywordAnalysis.findUnique for the analysisId owner-verify (null = unknown)

  beforeAll(async () => {
    queueAdd = jest.fn().mockResolvedValue({ id: 'run-1' });
    runCreate = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'run-1', ...args.data }),
    );
    runFindUnique = jest.fn((args: { where: Record<string, unknown> }) =>
      Promise.resolve('idempotencyKey' in args.where ? idempotencyRow : byIdRow),
    );
    analysisFindUnique = jest.fn(() => Promise.resolve(analysisRow ?? null));
    serpFetchAiOverviews = jest.fn().mockResolvedValue([]);
    serpFetchAiModes = jest.fn().mockResolvedValue([]);
    serpFetchBingCopilot = jest.fn().mockResolvedValue([]);

    const moduleRef = await overrideBackgroundWorkers(
      Test.createTestingModule({ imports: [AppModule] }),
    )
      .overrideProvider(getQueueToken(AI_SEARCH_QUEUE))
      .useValue({ add: queueAdd, getJob: jest.fn().mockResolvedValue(null) })
      .overrideProvider(SERP_AI_PROVIDER)
      .useValue({
        fetchAiOverviews: serpFetchAiOverviews,
        fetchAiModes: serpFetchAiModes,
        fetchBingCopilot: serpFetchBingCopilot,
      })
      .overrideProvider(BULL_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(PrismaService)
      .useValue({
        aiSearchRun: { findUnique: runFindUnique, create: runCreate, update: jest.fn() },
        keywordAnalysis: { findUnique: analysisFindUnique },
      })
      .overrideProvider(KeywordAnalysisProcessor)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
    idempotencyRow = null;
    byIdRow = null;
    analysisRow = null;
  });

  const post = (body: object) =>
    request(app.getHttpServer())
      .post('/api/v1/ai-search-analyses')
      .set('x-api-key', API_KEY)
      .send(body);

  const validBody = { keywords: ['asus zenbook'], channels: ['chatGpt', 'aiOverview'] };

  it('202 + {jobId} (enqueue-only, zero external calls)', async () => {
    idempotencyRow = null; // fresh → create + enqueue
    const res = await post(validBody).expect(202);
    expect(res.body).toEqual({ jobId: 'run-1' });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    // zero external calls on the POST path (SerpAPI provider never touched)
    expect(serpFetchAiOverviews).not.toHaveBeenCalled();
    expect(serpFetchAiModes).not.toHaveBeenCalled();
    expect(serpFetchBingCopilot).not.toHaveBeenCalled();
  });

  it('idempotency hit returns the same jobId without enqueuing again', async () => {
    idempotencyRow = { id: 'run-1', status: 'queued' }; // existing non-terminal run
    const res = await post(validBody).expect(202);
    expect(res.body).toEqual({ jobId: 'run-1' });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('links a provided analysisId (persists keywordAnalysisId) after owner-verify (T15.8a, #678 G1)', async () => {
    idempotencyRow = null; // fresh → create path
    analysisRow = { ownerId: null }; // known analysis; apiKey actor can access
    const analysisId = '5b5c5d5e-1111-4111-8111-111111111111'; // valid RFC-4122 v4
    await post({ ...validBody, analysisId }).expect(202);
    expect(analysisFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: analysisId } }),
    );
    expect(runCreate.mock.calls[0][0].data.keywordAnalysisId).toBe(analysisId);
  });

  it('does not link (keywordAnalysisId null) when analysisId is omitted — standalone (FR-41 backward compat)', async () => {
    idempotencyRow = null;
    await post(validBody).expect(202);
    expect(analysisFindUnique).not.toHaveBeenCalled();
    expect(runCreate.mock.calls[0][0].data.keywordAnalysisId).toBeNull();
  });

  it('404 when linking an unknown analysisId (owner-verify, no enqueue)', async () => {
    idempotencyRow = null;
    analysisRow = null; // unknown analysis → assertOwnedRow throws 404
    await post({ ...validBody, analysisId: '5b5c5d5e-1111-4111-8111-111111111111' }).expect(404);
    expect(runCreate).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('400 for a non-UUID analysisId (DTO validation)', async () => {
    await post({ ...validBody, analysisId: 'not-a-uuid' }).expect(400);
  });

  it('400 for empty keywords', async () => {
    await post({ keywords: [], channels: ['chatGpt'] }).expect(400);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('400 for empty channels', async () => {
    await post({ keywords: ['a'], channels: [] }).expect(400);
  });

  it('400 for an unknown channel', async () => {
    await post({ keywords: ['a'], channels: ['notAChannel'] }).expect(400);
  });

  it('400 for a non-UUID brandProfileId', async () => {
    await post({ keywords: ['a'], channels: ['chatGpt'], brandProfileId: 'nope' }).expect(400);
  });

  it('401 without an API key (global guard)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/ai-search-analyses')
      .send(validBody)
      .expect(401);
  });

  it('GET returns the run status', async () => {
    byIdRow = {
      id: RID,
      ownerId: null,
      status: 'partial',
      progress: { phase: 'done', percent: 100 },
      captureCount: 2,
    };
    const res = await request(app.getHttpServer())
      .get(`/api/v1/ai-search-analyses/${RID}`)
      .set('x-api-key', API_KEY)
      .expect(200);
    expect(res.body).toMatchObject({ jobId: RID, status: 'partial', captureCount: 2 });
  });

  it('GET returns 404 for an unknown run', async () => {
    byIdRow = null;
    await request(app.getHttpServer())
      .get(`/api/v1/ai-search-analyses/${RID}`)
      .set('x-api-key', API_KEY)
      .expect(404);
  });

  it('GET 400 for a malformed (non-UUID) :id — pipe short-circuits before the service', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ai-search-analyses/not-a-uuid')
      .set('x-api-key', API_KEY)
      .expect(400);
    expect(runFindUnique).not.toHaveBeenCalled();
  });

  it('SSE stream returns an empty (non-hanging) stream for an unknown run', async () => {
    byIdRow = null;
    await request(app.getHttpServer())
      .get(`/api/v1/ai-search-analyses/${RID}/stream`)
      .set('x-api-key', API_KEY)
      .expect(200);
  });

  it('SSE 400 for a malformed (non-UUID) :id — pipe rejects before the SSE handler', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ai-search-analyses/not-a-uuid/stream')
      .set('x-api-key', API_KEY)
      .expect(400);
  });
});
