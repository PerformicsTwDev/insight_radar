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
import type { SnapshotRowData } from 'src/keyword-analysis/result-snapshot.checksum';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';
import { PrismaService } from 'src/prisma';

const API_KEY = 'test-api-key';
const ID = '99999999-9999-9999-9999-999999999999';

function srow(over: Partial<SnapshotRowData> = {}): SnapshotRowData {
  return {
    text: 'kw',
    normalizedText: 'kw',
    avgMonthlySearches: 100,
    competition: 'LOW',
    competitionIndex: 10,
    cpcLow: 1,
    cpcHigh: 2,
    intent: ['informational'],
    monthlyVolumes: [],
    ...over,
  };
}

// 兩個不同 intentLabel → intent_distribution 分出 2 群；AGG_MAX_GROUPS=1 → 截斷到 top-1 + meta.truncated=true。
const ROWS: SnapshotRowData[] = [
  srow({ normalizedText: 'a', intent: ['commercial'] }),
  srow({ normalizedText: 'b', intent: ['informational'] }),
];

interface ChartBody {
  groups?: unknown[];
  meta?: { total: number; truncated: boolean };
}

/**
 * M6-R5（TC-36）：`meta.truncated` 經 **view-router → HTTP envelope** 端到端傳遞。群數超 `AGG_MAX_GROUPS`
 * → 截斷到 top-N 並回 `meta.truncated=true`（此前僅在 aggregate 引擎單元測，未經 HTTP 斷言）。
 */
describe('chart view truncation surfaces meta.truncated over HTTP (e2e, TC-36 / M6-R5)', () => {
  let app: INestApplication<App>;
  let savedMaxGroups: string | undefined;

  beforeAll(async () => {
    // 壓低群上限使 2 群觸發截斷（Joi min=1）。in-band 下 afterAll 還原，不洩漏給其他 e2e。
    savedMaxGroups = process.env.AGG_MAX_GROUPS;
    process.env.AGG_MAX_GROUPS = '1';

    const prisma = {
      keywordAnalysis: {
        findUnique: jest.fn(() =>
          Promise.resolve({ status: 'completed', resultSnapshotId: 'snap-1' }),
        ),
      },
      snapshotRow: { findMany: jest.fn(() => Promise.resolve(ROWS.map((data) => ({ data })))) },
    };

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
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(KeywordAnalysisProcessor)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (savedMaxGroups === undefined) {
      delete process.env.AGG_MAX_GROUPS;
    } else {
      process.env.AGG_MAX_GROUPS = savedMaxGroups;
    }
  });

  it('POST /query intent_distribution over the group cap → meta.truncated=true (top-N kept)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/keyword-analyses/${ID}/query`)
      .set('x-api-key', API_KEY)
      .send({ view: 'intent_distribution' });

    expect(res.status).toBe(200);
    const body = res.body as ChartBody;
    expect(body.meta?.truncated).toBe(true); // 端到端傳遞（此前僅引擎單元測）
    expect(body.groups).toHaveLength(1); // 截斷到 top-1（AGG_MAX_GROUPS=1）
    expect(body.meta?.total).toBe(2); // 截斷前的真實群數
  });
});
