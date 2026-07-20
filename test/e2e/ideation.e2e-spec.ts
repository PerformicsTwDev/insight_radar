import { getQueueToken } from '@nestjs/bullmq';
import { overrideBackgroundWorkers } from './helpers/background-workers';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import { AZURE_OPENAI_CLIENT } from 'src/intent/intent-labeler.port';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';

const API_KEY = 'test-api-key'; // matches .env.test

type Completion = {
  choices: { message: { parsed: { keywords: string[] } | null; refusal: string | null } }[];
};
const okCompletion = (keywords: string[]): Completion => ({
  choices: [{ message: { parsed: { keywords }, refusal: null } }],
});
const refusalCompletion: Completion = {
  choices: [{ message: { parsed: null, refusal: 'content_filter' } }],
};

/**
 * TC-71：`POST /ai-ideation`（T12.10，FR-35 / AC-35.1/35.3）。以假 AZURE_OPENAI_CLIENT 控制 LLM 輸出（無真 Azure/
 * Redis）；驗 200 happy（去重）、400（未知 template / 空 seeds / whitelist）、401、502（LLM 失敗）。
 */
describe('POST /ai-ideation (e2e, TC-71)', () => {
  let app: INestApplication<App>;
  const parse = jest.fn<Promise<Completion>, [unknown]>();

  beforeAll(async () => {
    parse.mockResolvedValue(okCompletion(['吸塵器評比', '吸塵器評比', '掃地機器人 推薦']));
    const azureClient = { chat: { completions: { parse } } };

    const moduleRef = await overrideBackgroundWorkers(
      Test.createTestingModule({ imports: [AppModule] }),
    )
      .overrideProvider(getQueueToken(KEYWORD_ANALYSIS_QUEUE))
      .useValue({ add: jest.fn(), getJob: jest.fn() })
      .overrideProvider(BULL_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(AZURE_OPENAI_CLIENT)
      .useValue(azureClient)
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

  const post = (body: object) =>
    request(app.getHttpServer()).post('/api/v1/ai-ideation').set('x-api-key', API_KEY).send(body);

  it('rejects a request without x-api-key (401)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/ai-ideation')
      .send({ template: 'long_tail', seeds: ['x'] })
      .expect(401);
  });

  it('AC-35.1: returns 200 { keywords } (deduped) for a valid template + seeds', async () => {
    const res = await post({ template: 'competitor_comparison', seeds: ['吸塵器'] }).expect(200);
    expect(res.body).toEqual({ keywords: ['吸塵器評比', '掃地機器人 推薦'] }); // dup removed
  });

  it('AC-35.3: an unknown template → 400', async () => {
    await post({ template: 'no_such_template', seeds: ['x'] }).expect(400);
  });

  it('AC-35.3: empty seeds → 400', async () => {
    await post({ template: 'long_tail', seeds: [] }).expect(400);
  });

  it('rejects an unknown field → 400 (global whitelist)', async () => {
    await post({ template: 'long_tail', seeds: ['x'], extra: 1 }).expect(400);
  });

  it('AC-35.1: an LLM failure → 502 (IDEATION_GENERATION_FAILED), never a half result 200', async () => {
    parse.mockResolvedValueOnce(refusalCompletion);
    const res = await post({ template: 'use_cases', seeds: ['x'] }).expect(502);
    expect((res.body as { code?: string }).code).toBe('IDEATION_GENERATION_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('content_filter');
  });
});
