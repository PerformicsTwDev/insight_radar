import type { BrandAliasInput } from '../brand-profile/brand-match';
import type { AiSearchCanonical } from '../captures/mapping/canonical.types';
import type { PrismaService } from '../prisma';
import { AiAnalysisService } from './ai-analysis.service';
import type { AiAnalysisRows } from './ai-analysis.types';
import type { BrandTextBlock } from './brand-extraction.postprocess';
import type { MediaReference } from './media-classifier.postprocess';
import type { SentimentTextBlock } from './sentiment.postprocess';

/**
 * TC-78 部分 (T15.5 · FR-42/AC-42.5)：AiAnalysisService 編排單元測試（三線 service + repo + prisma 皆 mock；
 * `buildAiVisibility` 用真純函式）。守：per-capture 聚合 + scope 分組 + partial 收斂 + 品牌載入分支 + block 攤平
 * + **per-line guard（M15-R3）** + **list block 可讀化（M15-R4）** + **原子 replaceForJob 持久化（M15-R8）**。
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
  replaceForJob: jest.Mock;
  findFirst: jest.Mock;
  // #678 G3：query→意圖/購買歷程維度映射載入（預設空 → 僅 keyword 維度、無回歸）。
  intentFindMany: jest.Mock;
  runFindUnique: jest.Mock;
  analysisFindUnique: jest.Mock;
  journeyFindMany: jest.Mock;
  // #678 G4：linked analysis 的不可變 snapshot 列（Search 線 avgMonthlySearches by normalizedText）。預設空 → exposure null。
  snapshotFindMany: jest.Mock;
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
    // 原子持久化：回三表落列筆數（＝各陣列長度，鏡射真 repo 對 fresh job 的 createMany count）。
    replaceForJob: jest.fn((_j, _o, _s, rows: AiAnalysisRows) =>
      Promise.resolve({
        answersCount: rows.answers.length,
        citedCount: rows.cited.length,
        metricsCount: rows.metrics.length,
      }),
    ),
    findFirst: jest.fn(() => Promise.resolve(BRAND_ROW)),
    intentFindMany: jest.fn(() => Promise.resolve([])),
    runFindUnique: jest.fn(() => Promise.resolve(null)),
    analysisFindUnique: jest.fn(() => Promise.resolve(null)),
    journeyFindMany: jest.fn(() => Promise.resolve([])),
    snapshotFindMany: jest.fn(() => Promise.resolve([])),
    ...over,
  };
  const service = new AiAnalysisService(
    { extractBrandsOutcome: m.extractBrandsOutcome },
    { analyzeSentimentOutcome: m.analyzeSentimentOutcome },
    { classifyMediaOutcome: m.classifyMediaOutcome },
    { replaceForJob: m.replaceForJob },
    {
      brandProfile: { findFirst: m.findFirst },
      keywordIntent: { findMany: m.intentFindMany },
      aiSearchRun: { findUnique: m.runFindUnique },
      keywordAnalysis: { findUnique: m.analysisFindUnique },
      keywordJourneyAssignment: { findMany: m.journeyFindMany },
      snapshotRow: { findMany: m.snapshotFindMany },
    } as unknown as PrismaService,
    { schemaVersion: 'v9' },
  );
  return { service, m };
}

/** 讀某 mock 第 `call` 次呼叫的第 `arg` 個引數（`unknown[][]` 索引安全，避免 jest.Mock 的 any 存取）。 */
function argOf<T>(mock: jest.Mock, call: number, arg: number): T {
  const calls = mock.mock.calls as unknown[][];
  return calls[call][arg] as T;
}

/** 讀 replaceForJob 首呼叫落下的三表 rows（answers/cited/metrics）。 */
function rowsOf(m: Mocks): AiAnalysisRows {
  return argOf<AiAnalysisRows>(m.replaceForJob, 0, 3);
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
  it('空 captures → 只清 slate（原子 replace 空列）、回零、不呼叫任何分析線', async () => {
    const { service, m } = build();
    const result = await service.analyzeAndPersist({ ...base, captures: [] });
    expect(result).toEqual({ answersCount: 0, citedCount: 0, metricsCount: 0, needsReview: 0 });
    expect(m.replaceForJob).toHaveBeenCalledWith('job-1', null, 'v9', {
      answers: [],
      cited: [],
      metrics: [],
    });
    expect(m.extractBrandsOutcome).not.toHaveBeenCalled();
  });

  it('captures → 三線分析 → 指標落庫（華碩→ASUS 正規化 + 不去重、citations 命中、per-brand 列）', async () => {
    const { service, m } = build();
    const result = await service.analyzeAndPersist({
      ...base,
      captures: [cap({ blocks: ['ASUS and 華碩 rock'] })],
    });
    expect(result.needsReview).toBe(0);
    expect(result.answersCount).toBe(1);

    const { answers, metrics } = rowsOf(m);
    expect(answers[0].brands).toEqual(['ASUS', 'ASUS']); // 華碩→ASUS，不去重＝露出次數
    expect(answers[0].positive).toBe(1);

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

  it('media 分類落 ai_cited_references（domain 正規化、原子 replace 帶 schemaVersion）', async () => {
    const { service, m } = build();
    await service.analyzeAndPersist({ ...base, captures: [cap()] });
    // 原子持久化：job/owner/schemaVersion + cited 列一併進單一 replaceForJob。
    expect(argOf<string>(m.replaceForJob, 0, 0)).toBe('job-1');
    expect(argOf<string | null>(m.replaceForJob, 0, 1)).toBeNull();
    expect(argOf<string>(m.replaceForJob, 0, 2)).toBe('v9');
    expect(rowsOf(m).cited).toEqual(
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
    const asus = rowsOf(m).metrics.filter((row) => row.brand === 'ASUS');
    expect(asus).toHaveLength(1); // 單一 scope（非兩列）
    expect(asus[0].mentions).toBe(2); // 兩 capture 各 1 → 加總
  });

  // ── #678 G3 (AC-43.3)：query→意圖(keyword_intents)/購買歷程(keyword_journey_assignments) join → 三維度 scope。 ──
  it('G3：intent/journey 映射齊備 → 指標落 keyword + intent + journey 三維度（僅加維度、露出不變）', async () => {
    const { service, m } = build({
      intentFindMany: jest.fn(() =>
        Promise.resolve([{ normalizedText: 'asus laptop', labels: ['commercial'] }]),
      ),
      runFindUnique: jest.fn(() => Promise.resolve({ keywordAnalysisId: 'ka-1' })),
      analysisFindUnique: jest.fn(() => Promise.resolve({ resultSnapshotId: 'snap-1' })),
      journeyFindMany: jest.fn(() =>
        Promise.resolve([{ normalizedText: 'asus laptop', stage: 'consideration' }]),
      ),
    });
    await service.analyzeAndPersist({ ...base, captures: [cap({ blocks: ['ASUS rocks'] })] });
    // 意圖映射全域 by normalizedText；購買歷程 by linked snapshot（jobId→run→analysis→snapshot）。
    expect(m.journeyFindMany).toHaveBeenCalledWith({
      where: { snapshotId: 'snap-1', normalizedText: { in: ['asus laptop'] } },
      select: { normalizedText: true, stage: true },
    });
    const { metrics } = rowsOf(m);
    const asus = (dim: string) => metrics.find((r) => r.brand === 'ASUS' && r.dimension === dim);
    expect(asus('keyword')).toMatchObject({ groupKey: 'asus laptop', mentions: 1 });
    expect(asus('intent')).toMatchObject({ groupKey: 'commercial', mentions: 1 });
    expect(asus('journey')).toMatchObject({ groupKey: 'consideration', mentions: 1 });
  });

  it('G3：無 intent/journey 映射（standalone / 未分類）→ 僅 keyword 維度（不硬崩）', async () => {
    const { service, m } = build(); // 預設映射空
    await service.analyzeAndPersist({ ...base, captures: [cap()] });
    const dims = new Set(rowsOf(m).metrics.map((r) => r.dimension));
    expect([...dims]).toEqual(['keyword']);
  });

  // ── #678 G4 (T15.8c, AC-43.1)：exposure 接 Search 線 avgMonthlySearches（linked analysis 不可變 snapshot，
  // by normalizedText；null 不補 0、全 null/空→null、真實 0 保留）。現況 scope searchVolumes=[] → exposure 恆 null＝紅。──
  it('G4：linked analysis snapshot 有 keyword avgMonthlySearches → keyword 維度 exposure = 加總（非本次查詢字忽略）', async () => {
    const { service, m } = build({
      runFindUnique: jest.fn(() => Promise.resolve({ keywordAnalysisId: 'ka-1' })),
      analysisFindUnique: jest.fn(() => Promise.resolve({ resultSnapshotId: 'snap-1' })),
      snapshotFindMany: jest.fn(() =>
        Promise.resolve([
          { data: { normalizedText: 'asus laptop', avgMonthlySearches: 1300 } },
          // snapshot 含分析其餘關鍵字（非本次 AI Search 查詢字）→ 不在 nts 集 → 略過（不進 volumeByNt）。
          { data: { normalizedText: 'unrelated kw', avgMonthlySearches: 999 } },
        ]),
      ),
    });
    await service.analyzeAndPersist({ ...base, captures: [cap()] }); // query 'asus laptop'
    // Search 線 avgMonthlySearches 以 linked analysis 的 resultSnapshotId 查（比照 G3 journey 解析鏈）。
    expect(m.snapshotFindMany).toHaveBeenCalledWith({
      where: { snapshotId: 'snap-1' },
      select: { data: true },
    });
    const kw = rowsOf(m).metrics.find((r) => r.dimension === 'keyword' && r.brand === 'ASUS');
    expect(kw?.exposure).toBe(1300);
  });

  it('G4：某 keyword avgMonthlySearches=null → 不計入（不補 0）；intent 範疇加總只含有值、全 null keyword scope → null', async () => {
    const { service, m } = build({
      // 兩相異字同屬 intent 'commercial' → intent scope 加總二者搜量。
      intentFindMany: jest.fn(() =>
        Promise.resolve([
          { normalizedText: 'asus laptop', labels: ['commercial'] },
          { normalizedText: 'acer laptop', labels: ['commercial'] },
        ]),
      ),
      runFindUnique: jest.fn(() => Promise.resolve({ keywordAnalysisId: 'ka-1' })),
      analysisFindUnique: jest.fn(() => Promise.resolve({ resultSnapshotId: 'snap-1' })),
      snapshotFindMany: jest.fn(() =>
        Promise.resolve([
          { data: { normalizedText: 'asus laptop', avgMonthlySearches: 1300 } },
          { data: { normalizedText: 'acer laptop', avgMonthlySearches: null } }, // 缺量 → null（不補 0）
        ]),
      ),
    });
    await service.analyzeAndPersist({
      ...base,
      captures: [cap({ query: 'asus laptop' }), cap({ query: 'acer laptop' })],
    });
    const metrics = rowsOf(m).metrics;
    // intent scope 'commercial' searchVolumes=[1300, null] → sumExposure=1300（null 不當 0）。
    const intent = metrics.find((r) => r.dimension === 'intent' && r.brand === 'ASUS');
    expect(intent?.groupKey).toBe('commercial');
    expect(intent?.exposure).toBe(1300);
    // 全 null 的 keyword scope（acer laptop）→ exposure null（不呈現假 0）。
    const acerKw = metrics.find(
      (r) => r.dimension === 'keyword' && r.groupKey === 'acer laptop' && r.brand === 'ASUS',
    );
    expect(acerKw?.exposure).toBeNull();
  });

  it('G4：standalone（無 linked analysis / 無 Search 資料）→ exposure null（不補 0）', async () => {
    const { service, m } = build(); // 預設無 run/analysis/snapshot → volumeByNt 空
    await service.analyzeAndPersist({ ...base, captures: [cap()] });
    const kw = rowsOf(m).metrics.find((r) => r.dimension === 'keyword' && r.brand === 'ASUS');
    expect(kw?.exposure).toBeNull();
  });

  it('G4：真實 avgMonthlySearches=0 → exposure 保留 0（與 null 語意不同、不遮蔽）', async () => {
    const { service, m } = build({
      runFindUnique: jest.fn(() => Promise.resolve({ keywordAnalysisId: 'ka-1' })),
      analysisFindUnique: jest.fn(() => Promise.resolve({ resultSnapshotId: 'snap-1' })),
      snapshotFindMany: jest.fn(() =>
        Promise.resolve([{ data: { normalizedText: 'asus laptop', avgMonthlySearches: 0 } }]),
      ),
    });
    await service.analyzeAndPersist({ ...base, captures: [cap()] });
    const kw = rowsOf(m).metrics.find((r) => r.dimension === 'keyword' && r.brand === 'ASUS');
    expect(kw?.exposure).toBe(0);
  });

  it('無 brandProfileId → 空品牌集：仍落 answers（原字保留）、指標 0 列、不查 DB、不判情緒', async () => {
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
    expect(rowsOf(m).answers[0].positive).toBe(0); // 未判情緒 → 預設 0
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

  it('某線降級（每 item fallback）→ job-level needsReview 收斂（三線相加）', async () => {
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
            { html: 'x' }, // 無已知文字欄（schema strip 後空）→ JSON.stringify
            { snippet: 42 }, // snippet 非字串 → aiTextBlockSchema 驗證失敗 → 續 fallback → JSON.stringify
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
      '{"snippet":42}',
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
    const { answers, cited } = rowsOf(m);
    expect(answers[0].brands).toEqual([]); // brandById.get(id) undefined → []
    expect(cited[0].mediaType).toBe('other'); // 缺分類 → other fallback
  });

  // ── M15-R3 (#685, INV-6)：某線 non-content_filter 基礎設施錯 throw → per-line guard，不丟他線、run 降 partial。 ──
  it('R3：情緒線 throw（Azure 500 類基礎設施錯）→ per-line guard：不整體 throw、他線保留、needsReview>0', async () => {
    const { service, m } = build({
      analyzeSentimentOutcome: jest.fn(() => Promise.reject(new Error('azure 500 boom'))),
    });
    // 現況（unguarded await）：整個 analyzeAndPersist reject → 下方斷言全數落空（red）。
    const result = await service.analyzeAndPersist({
      ...base,
      captures: [cap({ blocks: ['ASUS is great'] })],
    });
    expect(result.needsReview).toBeGreaterThan(0); // 情緒線失敗收斂 → job-level partial
    expect(result.answersCount).toBe(1); // 仍持久化（不整批失敗，不丟他線）
    const { answers } = rowsOf(m);
    expect(answers[0].brands).toEqual(['ASUS']); // 品牌線結果保留（未被情緒線的錯污染）
    expect(answers[0].positive).toBe(0); // 情緒線降級 → 預設 0
    expect(answers[0].negative).toBe(0);
  });

  it('R3：品牌線 throw → 情緒/媒體線保留、needsReview>0、不整體 throw', async () => {
    const { service, m } = build({
      extractBrandsOutcome: jest.fn(() => Promise.reject(new Error('azure timeout'))),
    });
    const result = await service.analyzeAndPersist({ ...base, captures: [cap()] });
    expect(result.needsReview).toBeGreaterThan(0);
    const { answers, cited } = rowsOf(m);
    expect(answers[0].brands).toEqual([]); // 品牌線降級 → 空（不污染他線）
    expect(answers[0].positive).toBe(1); // 情緒線仍運作
    expect(cited[0].mediaType).toBe('news'); // 媒體線仍運作
  });

  it('R3：媒體線 throw → 品牌/情緒線保留、needsReview>0', async () => {
    const { service, m } = build({
      classifyMediaOutcome: jest.fn(() => Promise.reject(new Error('azure 503'))),
    });
    const result = await service.analyzeAndPersist({ ...base, captures: [cap()] });
    expect(result.needsReview).toBeGreaterThan(0);
    const { answers, cited } = rowsOf(m);
    expect(answers[0].brands).toEqual(['ASUS']); // 品牌線保留
    expect(cited[0].mediaType).toBe('other'); // 媒體線降級 → other fallback（不污染他線）
  });

  // ── M15-R4 (#686)：AI-Overview list block（無 top-level snippet）→ 遞迴串接 snippet，非 JSON blob。 ──
  it('R4：list block → 遞迴取子項 snippet 串接為可讀文字（餵 LLM + 落 answerText）、非 {"type":"list"...}', async () => {
    const { service, m } = build();
    await service.analyzeAndPersist({
      ...base,
      captures: [
        cap({
          blocks: [
            {
              type: 'list',
              list: [
                { snippet: 'ASUS ZenBook' },
                { reference_indexes: [0] }, // 無 snippet/list → 攤平為空 → 跳過（不留空行）
                { snippet: 'Acer Swift', list: [{ snippet: 'thin and light' }] },
              ],
            },
          ],
        }),
      ],
    });
    const sent = argOf<BrandTextBlock[]>(m.extractBrandsOutcome, 0, 0);
    expect(sent[0].text).toBe('ASUS ZenBook\nAcer Swift\nthin and light'); // 遞迴串接
    expect(sent[0].text).not.toContain('{'); // 非 JSON blob
    expect(rowsOf(m).answers[0].answerText).toBe('ASUS ZenBook\nAcer Swift\nthin and light');
  });

  it('R4：heading/paragraph block（有 top-level snippet）→ 取 snippet（不受 list 分支影響）', async () => {
    const { service, m } = build();
    await service.analyzeAndPersist({
      ...base,
      captures: [cap({ blocks: [{ type: 'paragraph', snippet: 'ASUS is a top brand' }] })],
    });
    expect(argOf<BrandTextBlock[]>(m.extractBrandsOutcome, 0, 0)[0].text).toBe(
      'ASUS is a top brand',
    );
  });

  // ── M15-R8 (#689)：持久化經單一原子 replaceForJob（delete+creates 一致），非分散 persist。 ──
  it('R8：持久化經單一 replaceForJob（原子 delete+creates）——非三個分散 persist 呼叫', async () => {
    const { service, m } = build();
    await service.analyzeAndPersist({ ...base, captures: [cap()] });
    expect(m.replaceForJob).toHaveBeenCalledTimes(1);
    const rows = rowsOf(m);
    expect(rows.answers).toHaveLength(1);
    expect(rows.cited).toHaveLength(1);
    expect(rows.metrics.length).toBeGreaterThan(0);
  });
});
