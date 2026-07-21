import type { BrandAliasInput } from '../brand-profile/brand-match';
import type { AiSearchCanonical } from '../captures/mapping/canonical.types';
import type { PrismaService } from '../prisma';
import { AiAnalysisService } from './ai-analysis.service';
import type { AiAnswerRow, AiCitedReferenceRow, AiVisibilityMetricRow } from './ai-analysis.types';
import type { BrandTextBlock } from './brand-extraction.postprocess';
import type { MediaReference } from './media-classifier.postprocess';
import type { SentimentTextBlock } from './sentiment.postprocess';

/**
 * TC-78 部分 (T15.5 · FR-42/AC-42.5)：AiAnalysisService 編排單元測試（三線 service + repo + prisma 皆 mock；
 * `buildAiVisibility` 用真純函式）。守：per-capture 聚合 + scope 分組 + partial 收斂 + 品牌載入分支 + block 攤平。
 */

const BRAND_ROW = {
  id: 'bp-1',
  name: 'ASUS',
  aliases: ['華碩'],
  sites: ['asus.com'],
  competitors: [{ name: 'Acer', aliases: [], sites: ['acer.com'] }],
  createdAt: new Date(),
};

interface Mocks {
  extractBrandsOutcome: jest.Mock;
  analyzeSentimentOutcome: jest.Mock;
  classifyMediaOutcome: jest.Mock;
  deleteByJobId: jest.Mock;
  persistAnswers: jest.Mock;
  persistCitedReferences: jest.Mock;
  persistMetrics: jest.Mock;
  findFirst: jest.Mock;
}

function build(over: Partial<Mocks> = {}): { service: AiAnalysisService; m: Mocks } {
  const m: Mocks = {
    // 預設：模擬 extractBrandsOutcome 契約（回**已正規化** canonical names，不去重）——'ASUS'/'華碩' 皆 → 'ASUS'。
    extractBrandsOutcome: jest.fn((blocks: BrandTextBlock[]) => ({
      results: blocks.map((b) => {
        const brands: string[] = [];
        if (b.text.includes('ASUS')) brands.push('ASUS');
        if (b.text.includes('華碩')) brands.push('ASUS');
        return { id: b.id, brands };
      }),
      needsReview: [],
    })),
    analyzeSentimentOutcome: jest.fn((_brand: BrandAliasInput, blocks: SentimentTextBlock[]) => ({
      results: blocks.map((b) => ({ id: b.id, positive: 1, negative: 0 })),
      needsReview: [],
    })),
    classifyMediaOutcome: jest.fn((refs: MediaReference[]) => ({
      results: refs.map((r) => ({ id: r.id, type: 'news' })),
      needsReview: [],
    })),
    deleteByJobId: jest.fn(() => Promise.resolve()),
    persistAnswers: jest.fn((_j, _o, _s, rows: AiAnswerRow[]) => Promise.resolve(rows.length)),
    persistCitedReferences: jest.fn((_j, _o, _s, rows: AiCitedReferenceRow[]) =>
      Promise.resolve(rows.length),
    ),
    persistMetrics: jest.fn((_j, _o, _s, rows: AiVisibilityMetricRow[]) =>
      Promise.resolve(rows.length),
    ),
    findFirst: jest.fn(() => Promise.resolve(BRAND_ROW)),
    ...over,
  };
  const service = new AiAnalysisService(
    { extractBrandsOutcome: m.extractBrandsOutcome },
    { analyzeSentimentOutcome: m.analyzeSentimentOutcome },
    { classifyMediaOutcome: m.classifyMediaOutcome },
    {
      deleteByJobId: m.deleteByJobId,
      persistAnswers: m.persistAnswers,
      persistCitedReferences: m.persistCitedReferences,
      persistMetrics: m.persistMetrics,
    },
    { brandProfile: { findFirst: m.findFirst } } as unknown as PrismaService,
    { schemaVersion: 'v9' },
  );
  return { service, m };
}

/** 讀某 mock 第 `call` 次呼叫的第 `arg` 個引數（`unknown[][]` 索引安全，避免 jest.Mock 的 any 存取）。 */
function argOf<T>(mock: jest.Mock, call: number, arg: number): T {
  const calls = mock.mock.calls as unknown[][];
  return calls[call][arg] as T;
}

function cap(over: Partial<AiSearchCanonical> = {}): AiSearchCanonical {
  return {
    source: 'extension',
    channel: 'chatGpt',
    schemaVersion: 'v1',
    query: 'asus laptop',
    blocks: ['ASUS is great'],
    references: [{ title: 'ASUS', link: 'https://asus.com/x', index: 0 }],
    capturedAt: new Date().toISOString(),
    ...over,
  };
}

const base = { jobId: 'job-1', ownerId: null as string | null, brandProfileId: 'bp-1' };

describe('TC-78: AiAnalysisService orchestration (T15.5)', () => {
  it('空 captures → 只清 slate、回零、不呼叫任何分析線或持久化', async () => {
    const { service, m } = build();
    const result = await service.analyzeAndPersist({ ...base, captures: [] });
    expect(result).toEqual({ answersCount: 0, citedCount: 0, metricsCount: 0, needsReview: 0 });
    expect(m.deleteByJobId).toHaveBeenCalledWith('job-1');
    expect(m.extractBrandsOutcome).not.toHaveBeenCalled();
    expect(m.persistAnswers).not.toHaveBeenCalled();
  });

  it('captures → 三線分析 → 指標落庫（華碩→ASUS 正規化 + 不去重、citations 命中、per-brand 列）', async () => {
    const { service, m } = build();
    const result = await service.analyzeAndPersist({
      ...base,
      captures: [cap({ blocks: ['ASUS and 華碩 rock'] })],
    });
    expect(result.needsReview).toBe(0);
    expect(result.answersCount).toBe(1);

    const answers = argOf<AiAnswerRow[]>(m.persistAnswers, 0, 3);
    expect(answers[0].brands).toEqual(['ASUS', 'ASUS']); // 華碩→ASUS，不去重＝露出次數
    expect(answers[0].positive).toBe(1);

    const metrics = argOf<AiVisibilityMetricRow[]>(m.persistMetrics, 0, 3);
    const asus = metrics.find((row) => row.brand === 'ASUS');
    expect(asus).toMatchObject({
      dimension: 'keyword',
      groupKey: 'asus laptop',
      mentions: 2,
      citations: 1,
    });
    const acer = metrics.find((row) => row.brand === 'Acer');
    expect(acer).toMatchObject({ mentions: 0, shareOfVoice: 0 }); // 競品零提及、分母>0 → 真實 0
  });

  it('media 分類落 ai_cited_references（domain 正規化、schemaVersion 帶入）', async () => {
    const { service, m } = build();
    await service.analyzeAndPersist({ ...base, captures: [cap()] });
    expect(m.persistCitedReferences).toHaveBeenCalledWith(
      'job-1',
      null,
      'v9',
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'asus.com',
          mediaType: 'news',
          link: 'https://asus.com/x',
        }),
      ]),
    );
  });

  it('同 channel×query 多 captures → 聚合為單一 scope（mentions 加總）', async () => {
    const { service, m } = build();
    await service.analyzeAndPersist({
      ...base,
      captures: [cap({ blocks: ['ASUS one'] }), cap({ blocks: ['ASUS two'] })],
    });
    const metrics = argOf<AiVisibilityMetricRow[]>(m.persistMetrics, 0, 3);
    const asus = metrics.filter((row) => row.brand === 'ASUS');
    expect(asus).toHaveLength(1); // 單一 scope（非兩列）
    expect(asus[0].mentions).toBe(2); // 兩 capture 各 1 → 加總
  });

  it('無 brandProfileId → 空品牌集：仍落 answers（原字保留）、指標 0 列（buildAiVisibility 無品牌）、不查 DB、不判情緒', async () => {
    const { service, m } = build();
    const result = await service.analyzeAndPersist({
      jobId: 'j',
      ownerId: null,
      brandProfileId: null,
      captures: [cap()],
    });
    expect(m.findFirst).not.toHaveBeenCalled();
    expect(m.analyzeSentimentOutcome).not.toHaveBeenCalled(); // 無本品牌 → 略過情緒
    expect(result.metricsCount).toBe(0);
    expect(result.answersCount).toBe(1);
    const answers = argOf<AiAnswerRow[]>(m.persistAnswers, 0, 3);
    expect(answers[0].positive).toBe(0); // 未判情緒 → 預設 0
  });

  it('brandProfileId 但查無（owner 不符/已刪）→ 視同空品牌集（不硬崩，AC-40.3）', async () => {
    const { service, m } = build({ findFirst: jest.fn(() => Promise.resolve(null)) });
    const result = await service.analyzeAndPersist({ ...base, captures: [cap()] });
    expect(m.findFirst).toHaveBeenCalled();
    expect(result.metricsCount).toBe(0);
    expect(m.analyzeSentimentOutcome).not.toHaveBeenCalled();
  });

  // B1（code-review）：品牌載入須經 owner-scope 唯一單點語意（S8），不得 ad-hoc `where ownerId` 精確相等。
  it('owner-scope 單點（B1）：session-run（ownerId 非 null）→ 品牌 where = 自己 OR 共享（null），非精確相等', async () => {
    const { service, m } = build();
    await service.analyzeAndPersist({ ...base, ownerId: 'user-1', captures: [cap()] });
    const arg = argOf<{ where: Record<string, unknown> }>(m.findFirst, 0, 0);
    // session actor 應見「自己（user-1）+ 共享（null）」——精確相等會漏掉共享列（AC-27.3）。
    expect(arg.where).toEqual({ id: 'bp-1', OR: [{ ownerId: 'user-1' }, { ownerId: null }] });
  });

  it('owner-scope 單點（B1）：apiKey-run（ownerId=null，機器 actor）→ 品牌 where 不套 owner 過濾（見全部）', async () => {
    const { service, m } = build();
    await service.analyzeAndPersist({ ...base, ownerId: null, captures: [cap()] });
    const arg = argOf<{ where: Record<string, unknown> }>(m.findFirst, 0, 0);
    // 機器 actor 不過濾（AC-27.5）——ad-hoc `ownerId: null` 會誤把「session 擁有的品牌」擋掉。
    expect(arg.where).toEqual({ id: 'bp-1' });
    expect('ownerId' in arg.where).toBe(false);
  });

  it('某線降級 → job-level needsReview 收斂（三線相加）', async () => {
    const { service } = build({
      extractBrandsOutcome: jest.fn((blocks: BrandTextBlock[]) => ({
        results: blocks.map((b) => ({ id: b.id, brands: [] })),
        needsReview: [blocks[0]], // 品牌線降級 1 筆
      })),
      classifyMediaOutcome: jest.fn((refs: MediaReference[]) => ({
        results: refs.map((r) => ({ id: r.id, type: 'other' })),
        needsReview: [refs[0]], // 媒體線降級 1 筆
      })),
    });
    const result = await service.analyzeAndPersist({ ...base, captures: [cap()] });
    expect(result.needsReview).toBe(2);
  });

  it('block 攤平：物件文字欄（跳過非字串欄）、無文字欄→JSON、數值/布林/bigint String()、null→空', async () => {
    const { service, m } = build();
    await service.analyzeAndPersist({
      ...base,
      captures: [
        cap({
          blocks: [
            { text: 'ASUS obj' },
            { text: 123, content: 'from content' }, // text 非字串 → 續找 content
            { html: 'x' }, // 無已知文字欄 → JSON.stringify
            42,
            true,
            10n,
            null,
          ],
        }),
      ],
    });
    const sent = argOf<BrandTextBlock[]>(m.extractBrandsOutcome, 0, 0);
    expect(sent.map((b) => b.text)).toEqual([
      'ASUS obj',
      'from content',
      '{"html":"x"}',
      '42',
      'true',
      '10',
      '',
    ]);
  });

  it('缺 brand/media 結果（某 block/ref id 不在結果集）→ 補預設（brands []、mediaType other 不污染）', async () => {
    const { service, m } = build({
      // 回空 results → 某 block id 不在 brandById → `?? []` fallback（非只是空品牌陣列）。
      extractBrandsOutcome: jest.fn(() => ({ results: [], needsReview: [] })),
      classifyMediaOutcome: jest.fn(() => ({ results: [], needsReview: [] })), // 無 media 結果 → get() undefined
    });
    await service.analyzeAndPersist({ ...base, captures: [cap()] });
    const answers = argOf<AiAnswerRow[]>(m.persistAnswers, 0, 3);
    expect(answers[0].brands).toEqual([]); // brandById.get(id) undefined → []
    const cited = argOf<AiCitedReferenceRow[]>(m.persistCitedReferences, 0, 3);
    expect(cited[0].mediaType).toBe('other'); // 缺分類 → other fallback
  });
});
