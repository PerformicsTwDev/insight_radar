import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { queryConfig } from 'src/config/query.config';
import type { SnapshotRowData } from 'src/keyword-analysis/result-snapshot.checksum';
import { KeywordsModule } from 'src/keywords/keywords.module';
import { SnapshotQueryService } from 'src/keywords/snapshot-query.service';
import { PrismaService } from 'src/prisma';

function srow(over: Partial<SnapshotRowData> = {}): SnapshotRowData {
  const nt = over.normalizedText ?? over.text ?? 'kw';
  return {
    text: nt,
    normalizedText: nt,
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

const LIMIT_ENV_KEYS = ['QUERY_MAX_PAGE_SIZE', 'AGG_MAX_BUCKETS', 'AGG_MAX_GROUPS'] as const;

/**
 * TC-17（FR-6 · NFR-7）：對**不可變** `ResultSnapshot` 的 keyset 翻頁在真實 Postgres 上**不漂移**。
 * 全序（sort 值 + `normalizedText` tie-break）確保有 tie 時跨頁不重複/不跳漏、重複查一致；讀取層只讀 snapshot，
 * 活 `Keyword` 資料變動不影響已固化結果（「對活資料分頁會漂移」的反例）。
 */
describe('snapshot pagination stability (integration · Testcontainers, TC-17 / NFR-7)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: SnapshotQueryService;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of LIMIT_ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    process.env.QUERY_MAX_PAGE_SIZE = '200';
    process.env.AGG_MAX_BUCKETS = '200';
    process.env.AGG_MAX_GROUPS = '1000';
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [queryConfig] }), KeywordsModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(SnapshotQueryService);
  });

  afterEach(async () => {
    await prisma.snapshotRow.deleteMany();
    await prisma.keyword.deleteMany();
    await prisma.keywordAnalysis.updateMany({ data: { resultSnapshotId: null } });
    await prisma.resultSnapshot.deleteMany();
    await prisma.keywordAnalysis.deleteMany();
  });

  afterAll(async () => {
    await moduleRef.close();
    for (const key of LIMIT_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  /** 固化一個 completed analysis + 不可變 snapshot 於真實 Postgres，回 analysisId。 */
  async function seedSnapshot(rows: SnapshotRowData[]): Promise<string> {
    const analysisId = randomUUID();
    const snapshotId = randomUUID();
    await prisma.keywordAnalysis.create({
      data: {
        id: analysisId,
        status: 'running',
        seeds: [],
        params: {},
        progress: {},
        idempotencyKey: `idem-${analysisId}`,
      },
    });
    await prisma.resultSnapshot.create({
      data: { id: snapshotId, analysisId, keywordCount: rows.length, checksum: 'x' },
    });
    await prisma.snapshotRow.createMany({
      data: rows.map((data, rowIndex) => ({
        snapshotId,
        analysisId,
        rowIndex,
        data: data as unknown as Prisma.InputJsonValue,
      })),
    });
    await prisma.keywordAnalysis.update({
      where: { id: analysisId },
      data: { status: 'completed', resultSnapshotId: snapshotId },
    });
    return analysisId;
  }

  /** 依 meta.cursor keyset 逐頁走完，回各列 `text`（依走訪序）。 */
  async function pageAllTexts(analysisId: string, pageSize: number): Promise<string[]> {
    const texts: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 1000; guard++) {
      const res = await service.listKeywords(analysisId, {}, {}, { pageSize, cursor });
      texts.push(...res.data.map((r) => r.text));
      if (!res.meta.cursor) {
        return texts;
      }
      cursor = res.meta.cursor;
    }
    throw new Error('pagination did not terminate');
  }

  it('keyset paginates a tied snapshot with full, non-overlapping, deterministic coverage', async () => {
    // 10 列全同搜量 → 排序全靠 normalizedText tie-break。**逆序固化**（rowIndex 降冪）：若 tie-break 被拿掉，
    // 穩定排序會保留插入序（逆序）→ 與期望的 nt asc 不符而翻紅 → 這是真正的全序守衛（非退化為插入序）。
    const ntAsc = Array.from({ length: 10 }, (_, i) => `kw-${String(i).padStart(2, '0')}`);
    const rows = [...ntAsc]
      .reverse()
      .map((normalizedText) => srow({ normalizedText, avgMonthlySearches: 100 }));
    const id = await seedSnapshot(rows);

    const texts = await pageAllTexts(id, 3); // pageSize 不整除 → tie 跨頁邊界

    expect(texts).toHaveLength(10);
    expect(new Set(texts).size).toBe(10); // 無重複
    expect(texts).toEqual(ntAsc); // 完整覆蓋 + 全序（nt asc，非插入的逆序）
  });

  it('repeated full pagination yields the identical sequence (no drift)', async () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      srow({ normalizedText: `t-${String(i).padStart(2, '0')}`, avgMonthlySearches: 50 }),
    );
    const id = await seedSnapshot(rows);

    const first = await pageAllTexts(id, 2);
    const second = await pageAllTexts(id, 2);
    expect(second).toEqual(first);
  });

  it('primary sort + tie-break stay stable across page boundaries', async () => {
    // 兩個搜量群，群內 tie → desc 主序 + nt tie-break 必須跨頁一致。
    const rows = [
      srow({ normalizedText: 'b-hi', avgMonthlySearches: 300 }),
      srow({ normalizedText: 'a-hi', avgMonthlySearches: 300 }),
      srow({ normalizedText: 'c-lo', avgMonthlySearches: 100 }),
      srow({ normalizedText: 'a-lo', avgMonthlySearches: 100 }),
    ];
    const id = await seedSnapshot(rows);

    const texts = await pageAllTexts(id, 2); // 邊界落在 300 群與 100 群之間
    expect(texts).toEqual(['a-hi', 'b-hi', 'a-lo', 'c-lo']); // 群 desc、群內 nt asc
  });

  it('is decoupled from live Keyword data: mutating keywords does not shift the snapshot result', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      srow({ normalizedText: `s-${i}`, avgMonthlySearches: 100 }),
    );
    const id = await seedSnapshot(rows);
    const before = await pageAllTexts(id, 2);

    // 之後活 Keyword 表新增/變動——讀取層只讀不可變 snapshot，故結果不得改變（NFR-7）。
    await prisma.keyword.createMany({
      data: Array.from({ length: 8 }, (_, i) => ({
        geo: 'TW',
        language: 'zh',
        normalizedText: `live-${i}`,
        text: `live-${i}`,
        avgMonthlySearches: 999,
      })),
    });

    const after = await pageAllTexts(id, 2);
    expect(after).toEqual(before); // 固化 snapshot 不受活資料影響
    expect(after).toHaveLength(5);
  });
});
