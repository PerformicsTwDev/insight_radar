import {
  type AiVisibilityScope,
  type VisibilityBrand,
  buildAiVisibility,
  citationHitsBrand,
  countCitations,
  countMentions,
  shareOfVoice,
  sumExposure,
} from './visibility-metrics';

/**
 * TC-79（FR-43 / AC-43.1/43.2/43.3）——AI 可見度指標**純函式**。
 * 鎖死正確性單點：
 *  (a) SoV 零提及（分母 0 或分子 0）→ null（**非 0、非 NaN**）；
 *  (b) exposure：null 不補 0（含 null 的加總跳過該筆、全 null/空 → null）；
 *  (c) mentions 不去重（＝露出次數，沿用 T15.2）；
 *  (d) citations 命中 BrandProfile.sites/domain 計數；
 *  (e) 維度 keyword / 意圖 / 購買歷程 透傳與各自計算。
 */

const ASUS: VisibilityBrand = { name: 'ASUS', sites: ['asus.com'] };
const ACER: VisibilityBrand = { name: 'Acer', sites: ['acer.com'] };

describe('shareOfVoice — AC-43.2 分母/分子語意（零提及→null，不除 0、不 NaN）', () => {
  it('正常：品牌提及 ÷ 全品牌提及總數（回比例，view 層才呈現為 %）', () => {
    expect(shareOfVoice(3, 4)).toBe(0.75);
    expect(shareOfVoice(1, 4)).toBe(0.25);
  });

  it('分母 0（零品牌提及）→ null（不除 0、不 NaN、不呈現 0%）', () => {
    const result = shareOfVoice(0, 0);
    expect(result).toBeNull();
    expect(Number.isNaN(result as unknown as number)).toBe(false);
  });

  it('分子 0（該品牌零提及、他牌有提及）→ null（不呈現 0% 假訊號）', () => {
    expect(shareOfVoice(0, 4)).toBeNull();
  });

  it('分子 > 0 但分母 0（病態輸入）→ null（防禦性，不除 0）', () => {
    expect(shareOfVoice(5, 0)).toBeNull();
  });
});

describe('sumExposure — AC-43.1 曝光 avgMonthlySearches 加總（null 不補 0）', () => {
  it('含 null：跳過該筆、其餘加總（不補 0）', () => {
    expect(sumExposure([100, null, 200])).toBe(300);
  });

  it('全部有值：直接加總', () => {
    expect(sumExposure([100, 200, 300])).toBe(600);
  });

  it('全 null → null（不呈現假的 0）', () => {
    expect(sumExposure([null, null])).toBeNull();
  });

  it('空集 → null', () => {
    expect(sumExposure([])).toBeNull();
  });

  it('單一 0（真實的 0 搜量）保留為 0，不與 null 混淆', () => {
    expect(sumExposure([0, null])).toBe(0);
  });
});

describe('countMentions — AC-43.1 露出次數（不去重）', () => {
  it('同品牌多次出現計多次（＝露出次數，S17 不去重）', () => {
    expect(countMentions(['ASUS', 'ASUS', 'Acer'], 'ASUS')).toBe(2);
  });

  it('未出現的品牌 → 0', () => {
    expect(countMentions(['ASUS', 'Acer'], 'MSI')).toBe(0);
  });

  it('空提及集 → 0', () => {
    expect(countMentions([], 'ASUS')).toBe(0);
  });
});

describe('citationHitsBrand / countCitations — AC-43.1 命中 sites/domain 計數', () => {
  it('URL 命中官網 domain（含 www、path）', () => {
    expect(citationHitsBrand('https://www.asus.com/tw/laptops', ['asus.com'])).toBe(true);
  });

  it('子網域後綴命中（rog.asus.com 命中 asus.com）', () => {
    expect(citationHitsBrand('https://rog.asus.com/x', ['asus.com'])).toBe(true);
  });

  it('裸 domain 形式的 site 也能命中（無 scheme）', () => {
    expect(citationHitsBrand('https://acer.com/products', ['acer.com'])).toBe(true);
  });

  it('非命中 domain → false', () => {
    expect(citationHitsBrand('https://competitor.com/x', ['asus.com'])).toBe(false);
  });

  it('相似但非後綴 domain 不誤命中（notasus.com 不命中 asus.com）', () => {
    expect(citationHitsBrand('https://notasus.com', ['asus.com'])).toBe(false);
  });

  it('無法解析的 link → false（不拋）', () => {
    expect(citationHitsBrand('not a url', ['asus.com'])).toBe(false);
    expect(citationHitsBrand('', ['asus.com'])).toBe(false);
  });

  it('空 site 條目被忽略、不誤命中', () => {
    expect(citationHitsBrand('https://asus.com', [''])).toBe(false);
  });

  it('countCitations：逐筆命中計數（多筆同 domain 各計一次）', () => {
    const links = [
      'https://www.asus.com/a',
      'https://rog.asus.com/b',
      'https://acer.com/c',
      'https://other.com/d',
    ];
    expect(countCitations(links, ['asus.com'])).toBe(2);
    expect(countCitations(links, ['acer.com'])).toBe(1);
    expect(countCitations(links, ['msi.com'])).toBe(0);
  });
});

describe('buildAiVisibility — per channel × brand × dimension（整合）', () => {
  it('綜合：mentions 不去重 + SoV 比例 + citations 命中 + exposure null 跳過', () => {
    const scope: AiVisibilityScope = {
      channel: 'chatGpt',
      dimension: 'keyword',
      group: 'gaming laptop',
      // ASUS 露出 3 次（不去重）、Acer 1 次、未追蹤品牌 MSI 1 次 → 全品牌提及總數 = 5。
      mentions: ['ASUS', 'ASUS', 'ASUS', 'Acer', 'MSI'],
      citations: [
        'https://www.asus.com/laptops',
        'https://rog.asus.com/review',
        'https://acer.com/store',
      ],
      // 100 + (null 跳過) + 200 = 300。
      searchVolumes: [100, null, 200],
    };

    const cells = buildAiVisibility([scope], [ASUS, ACER]);

    const asus = cells.find((c) => c.brand === 'ASUS');
    const acer = cells.find((c) => c.brand === 'Acer');

    expect(asus).toEqual({
      channel: 'chatGpt',
      dimension: 'keyword',
      group: 'gaming laptop',
      brand: 'ASUS',
      mentions: 3, // 不去重
      shareOfVoice: 3 / 5, // 分母含未追蹤 MSI 露出
      citations: 2, // asus.com + rog.asus.com
      exposure: 300, // null 跳過、不補 0
    });
    expect(acer).toEqual({
      channel: 'chatGpt',
      dimension: 'keyword',
      group: 'gaming laptop',
      brand: 'Acer',
      mentions: 1,
      shareOfVoice: 1 / 5,
      citations: 1,
      exposure: 300, // 曝光為範疇屬性，per-brand cell 皆同值
    });
  });

  it('零品牌提及範疇：SoV=null（非 0/NaN）、mentions=0、exposure 仍照常', () => {
    const scope: AiVisibilityScope = {
      channel: 'aiOverview',
      dimension: 'keyword',
      group: 'no-brand-answer',
      mentions: [], // 分母 0
      citations: [],
      searchVolumes: [500],
    };

    const [asus, acer] = buildAiVisibility([scope], [ASUS, ACER]);

    expect(asus.mentions).toBe(0);
    expect(asus.shareOfVoice).toBeNull();
    expect(Number.isNaN(asus.shareOfVoice as unknown as number)).toBe(false);
    expect(asus.exposure).toBe(500);
    expect(acer.shareOfVoice).toBeNull();
  });

  it('該品牌零提及但他牌有提及：分子 0 → SoV=null（不呈現 0%）', () => {
    const scope: AiVisibilityScope = {
      channel: 'geminiApp',
      dimension: 'keyword',
      group: 'acer only',
      mentions: ['Acer', 'Acer'],
      citations: [],
      searchVolumes: [null], // 全 null → exposure null
    };

    const cells = buildAiVisibility([scope], [ASUS, ACER]);
    const asus = cells.find((c) => c.brand === 'ASUS');
    const acer = cells.find((c) => c.brand === 'Acer');

    expect(asus?.mentions).toBe(0);
    expect(asus?.shareOfVoice).toBeNull(); // 分子 0 → null
    expect(acer?.shareOfVoice).toBe(1); // 2/2
    expect(asus?.exposure).toBeNull(); // 全 null 不補 0
  });

  it('AC-43.3 維度：keyword / 意圖 / 購買歷程 皆支援且透傳、各自計算', () => {
    const scopes: AiVisibilityScope[] = [
      {
        channel: 'chatGpt',
        dimension: 'keyword',
        group: 'gaming laptop',
        mentions: ['ASUS'],
        citations: [],
        searchVolumes: [100],
      },
      {
        channel: 'chatGpt',
        dimension: 'intent',
        group: 'commercial-research', // 意圖主題
        mentions: ['ASUS', 'Acer'],
        citations: [],
        searchVolumes: [100, 200],
      },
      {
        channel: 'chatGpt',
        dimension: 'journey',
        group: 'consideration', // 購買歷程主題
        mentions: ['Acer', 'Acer', 'ASUS'],
        citations: [],
        searchVolumes: [null, 50],
      },
    ];

    const cells = buildAiVisibility(scopes, [ASUS, ACER]);

    const dims = cells.map((c) => c.dimension);
    expect(new Set(dims)).toEqual(new Set(['keyword', 'intent', 'journey']));

    const keywordAsus = cells.find((c) => c.dimension === 'keyword' && c.brand === 'ASUS');
    expect(keywordAsus?.group).toBe('gaming laptop');
    expect(keywordAsus?.shareOfVoice).toBe(1); // 1/1
    expect(keywordAsus?.exposure).toBe(100);

    const intentAcer = cells.find((c) => c.dimension === 'intent' && c.brand === 'Acer');
    expect(intentAcer?.group).toBe('commercial-research');
    expect(intentAcer?.shareOfVoice).toBe(0.5); // 1/2
    expect(intentAcer?.exposure).toBe(300);

    const journeyAcer = cells.find((c) => c.dimension === 'journey' && c.brand === 'Acer');
    expect(journeyAcer?.group).toBe('consideration');
    expect(journeyAcer?.mentions).toBe(2); // 不去重
    expect(journeyAcer?.shareOfVoice).toBe(2 / 3);
    expect(journeyAcer?.exposure).toBe(50); // null 跳過
  });

  it('每個品牌（本品牌 + 競品）皆產出一列，即使零提及（view 需完整列）', () => {
    const scope: AiVisibilityScope = {
      channel: 'chatGpt',
      dimension: 'keyword',
      group: 'x',
      mentions: ['ASUS'],
      citations: [],
      searchVolumes: [10],
    };
    const cells = buildAiVisibility([scope], [ASUS, ACER]);
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.brand)).toEqual(['ASUS', 'Acer']);
  });

  it('空 scopes → 空結果（不拋）', () => {
    expect(buildAiVisibility([], [ASUS, ACER])).toEqual([]);
  });
});
