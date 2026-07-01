import { getQueueToken } from '@nestjs/bullmq';
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
const ID = '88888888-8888-8888-8888-888888888888';

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

// 一列有指標、一列缺值（avgMonthlySearches=null）——用來分辨「未設 volume 約束」與「誤丟缺值列」。
const ROWS: SnapshotRowData[] = [
  srow({ normalizedText: 'has', avgMonthlySearches: 100 }),
  srow({ normalizedText: 'none', avgMonthlySearches: null }),
];

interface Body {
  rows?: unknown[];
}

/**
 * M6-R1（AC-14.3 / 缺值≠0）：`POST /query` filters 的顯式 JSON `null` 視為**未設**（不施加約束），
 * 不得：① `q:null` → 500 crash；② `volumeMin:null` 以 null 界啟動 predicate 而靜默丟缺值列。
 * 對照：真正的 `volumeMin:50` 仍正確排除缺值列（缺值不滿足已設界）。
 */
describe('POST /query null filter values are treated as unset (e2e, M6-R1)', () => {
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
  });

  const url = `/api/v1/keyword-analyses/${ID}/query`;
  const post = (body: object) =>
    request(app.getHttpServer()).post(url).set('x-api-key', API_KEY).send(body);
  const rowsOf = (res: request.Response) => (res.body as Body).rows;

  it('q:null is unset — no 500 crash, returns all rows', async () => {
    const res = await post({ view: 'keywords', filters: { q: null } });
    expect(res.status).toBe(200); // 不得 500（null.toLowerCase）
    expect(rowsOf(res)).toHaveLength(2);
  });

  it('volumeMin:null is unset — does not drop the null-metric row', async () => {
    const res = await post({ view: 'keywords', filters: { volumeMin: null } });
    expect(res.status).toBe(200);
    expect(rowsOf(res)).toHaveLength(2); // 'none'（缺值列）不得被丟
  });

  it('a real volumeMin still excludes null-metric rows (缺值≠0, unchanged)', async () => {
    const res = await post({ view: 'keywords', filters: { volumeMin: 50 } });
    expect(res.status).toBe(200);
    expect(rowsOf(res)).toHaveLength(1); // 只留 'has'（100 >= 50）；'none' 缺值被排除
  });
});
