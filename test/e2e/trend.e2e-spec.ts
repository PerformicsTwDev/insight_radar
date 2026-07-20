import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/bootstrap';
import { KeywordAnalysisProcessor } from 'src/keyword-analysis/keyword-analysis.processor';
import { TopicClusterProcessor } from 'src/topics/topic-cluster.processor';
import { JourneyProcessor } from 'src/journey/journey.processor';
import {
  CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION,
  CUSTOM_CLASSIFY_QUEUE_EVENTS,
} from 'src/queue/custom-classify-job-events.constants';
import {
  AI_SEARCH_JOB_EVENTS_CONNECTION,
  AI_SEARCH_QUEUE_EVENTS,
} from 'src/queue/ai-search-job-events.constants';
import { CustomClassifyAssignProcessor } from 'src/custom-classify/custom-classify-assign.processor';
import { AiSearchProcessor } from 'src/ai-search/ai-search.processor';
import { TrackingRefreshProcessor } from 'src/tracking/tracking-refresh.processor';
import type { SnapshotRowData } from 'src/keyword-analysis/result-snapshot.checksum';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from 'src/queue/job-events.constants';
import {
  TOPIC_JOB_EVENTS_CONNECTION,
  TOPIC_QUEUE_EVENTS,
} from 'src/queue/topic-job-events.constants';
import {
  JOURNEY_JOB_EVENTS_CONNECTION,
  JOURNEY_QUEUE_EVENTS,
} from 'src/queue/journey-job-events.constants';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from 'src/queue/queue.constants';
import { PrismaService } from 'src/prisma';

const API_KEY = 'test-api-key';
const ANALYSIS_ID = '44444444-4444-4444-4444-444444444444';

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

// a=commercial（1月100、2月40）、b=informational（1月30、2月10）。
// 全體月度 total = [130, 50]；篩選到 commercial → [100, 40]（證 total 與表格共用同一 FilterSpec）。
const ROWS: SnapshotRowData[] = [
  srow({
    text: 'a',
    normalizedText: 'a',
    intent: ['commercial'],
    monthlyVolumes: [
      { year: 2026, month: 1, searches: 100 },
      { year: 2026, month: 2, searches: 40 },
    ],
  }),
  srow({
    text: 'b',
    normalizedText: 'b',
    intent: ['informational'],
    monthlyVolumes: [
      { year: 2026, month: 1, searches: 30 },
      { year: 2026, month: 2, searches: 10 },
    ],
  }),
];

interface TrendBody {
  view: string;
  axis?: string[];
  total?: number[];
  series?: { key: unknown; values: (number | null)[] }[];
}
interface KeywordsBody {
  view: string;
  rows?: { text?: string; monthlyVolumes?: { month: number; searches: number }[] }[];
}
const asTrend = (res: request.Response): TrendBody => res.body as TrendBody;
const asKw = (res: request.Response): KeywordsBody => res.body as KeywordsBody;

/**
 * TC-24（FR-5/7/14）：趨勢資料路徑。`view:'trend'` 給月度 `total`（sum(monthlySearches)）且反映目前 `FilterSpec`；
 * `view:'keywords'` top-N 原始列含 `monthlyVolumes` 供前端組個別 series；**無** `/trend`、`/aggregate` 端點。
 */
describe('trend data path (e2e, TC-24)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const prisma = {
      keywordAnalysis: {
        findUnique: jest.fn(() =>
          Promise.resolve({ status: 'completed', resultSnapshotId: 'snap-1' }),
        ),
      },
      snapshotRow: { findMany: jest.fn(() => Promise.resolve(ROWS.map((data) => ({ data })))) },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getQueueToken(KEYWORD_ANALYSIS_QUEUE))
      .useValue({ add: jest.fn(), getJob: jest.fn() })
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
      .useValue(prisma)
      .overrideProvider(KeywordAnalysisProcessor)
      .useValue({})
      .overrideProvider(JOURNEY_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(JOURNEY_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(JourneyProcessor)
      .useValue({})
      .overrideProvider(CUSTOM_CLASSIFY_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(CUSTOM_CLASSIFY_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(CustomClassifyAssignProcessor)
      .useValue({})
      .overrideProvider(AI_SEARCH_JOB_EVENTS_CONNECTION)
      .useValue(new RedisMock())
      .overrideProvider(AI_SEARCH_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close: () => Promise.resolve() })
      .overrideProvider(AiSearchProcessor)
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

  const base = `/api/v1/keyword-analyses/${ANALYSIS_ID}`;
  const post = (path: string, body: object) =>
    request(app.getHttpServer()).post(`${base}${path}`).set('x-api-key', API_KEY).send(body);

  it('view=trend gives month-aligned total = sum(monthlySearches) over all rows', async () => {
    const res = await post('/query', { view: 'trend' });
    expect(res.status).toBe(200);
    expect(asTrend(res).axis).toEqual(['2026-01', '2026-02']);
    expect(asTrend(res).total).toEqual([130, 50]); // a+b per month
  });

  it('view=trend total reflects the current FilterSpec (same predicate as the table)', async () => {
    const res = await post('/query', { view: 'trend', filters: { intent: ['commercial'] } });
    expect(res.status).toBe(200);
    expect(asTrend(res).total).toEqual([100, 40]); // only a (commercial)
  });

  it('view=keywords returns raw rows carrying monthlyVolumes for per-keyword series', async () => {
    const res = await post('/query', {
      view: 'keywords',
      select: ['text', 'monthlyVolumes'],
      sort: [{ field: 'avgMonthlySearches', direction: 'desc' }],
    });
    expect(res.status).toBe(200);
    const rowA = asKw(res).rows?.find((r) => r.text === 'a');
    expect(rowA?.monthlyVolumes).toEqual([
      { year: 2026, month: 1, searches: 100 },
      { year: 2026, month: 2, searches: 40 },
    ]);
  });

  it('has NO dedicated /trend or /aggregate endpoints (view-router only)', async () => {
    expect((await post('/trend', { view: 'trend' })).status).toBe(404);
    expect((await post('/aggregate', {})).status).toBe(404);
  });
});
