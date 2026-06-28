import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GoogleAdsService } from './google-ads.service';
import type { AdsClient, KeywordIdeaResult } from './ads-client.port';

/**
 * Contract test (TC-14)：以錄製的 generateKeywordIdeas 回應 fixture（golden）驗證映射正確，
 * 並在上游欄位漂移時轉紅（早期預警）。fixture 經 fake client 餵入真實的 expand 管線。
 */
interface Fixture {
  _meta: { fixtureVersion: number; packageVersion: string };
  results: KeywordIdeaResult[];
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'generate-keyword-ideas.json'), 'utf8'),
) as Fixture;

class FixtureAdsClient implements AdsClient {
  generateKeywordIdeas(): Promise<KeywordIdeaResult[]> {
    return Promise.resolve(fixture.results);
  }
}

const PARAMS = {
  geo: 'geoTargetConstants/2158',
  language: 'languageConstants/1018',
  currencyCode: 'TWD',
};

describe('GenerateKeywordIdeas contract (TC-14)', () => {
  it('declares the fixture version (drift marker)', () => {
    expect(fixture._meta.fixtureVersion).toBe(1);
    expect(fixture._meta.packageVersion).toBe('24.1.0');
  });

  it('maps the recorded response to the golden Keyword[] output', async () => {
    const service = new GoogleAdsService(new FixtureAdsClient());
    const out = await service.expand(['coffee'], PARAMS);
    const byKey = Object.fromEntries(out.map((k) => [k.normalizedText, k]));

    // seed「coffee」：原字保留、source=seed、micros÷1e6、competition enum、月份名稱映射 + null 月保留
    expect(byKey['coffee']).toMatchObject({
      text: 'coffee',
      source: 'seed',
      avgMonthlySearches: 110000,
      competition: 'LOW',
      competitionIndex: 12,
      cpcLow: 1.23,
      cpcHigh: 4.56,
      cpcLowMicros: '1230000',
      cpcHighMicros: '4560000',
      currencyCode: 'TWD',
      monthlyVolumes: [
        { year: 2024, month: 12, searches: 100000 },
        { year: 2025, month: 1, searches: 110000 },
        { year: 2025, month: 2, searches: null },
      ],
    });

    // 拓展「coffee machine」：source=expanded、seedOrigins、HIGH competition
    expect(byKey['coffee machine']).toMatchObject({
      source: 'expanded',
      seedOrigins: ['coffee'],
      avgMonthlySearches: 27000,
      competition: 'HIGH',
      competitionIndex: 88,
      cpcLow: 3,
      cpcHigh: 9.5,
    });

    // low-volume：缺值一律 null（不補 0），competition=UNKNOWN，空月份陣列
    expect(byKey['low volume keyword']).toMatchObject({
      source: 'expanded',
      avgMonthlySearches: null,
      competition: 'UNKNOWN',
      competitionIndex: null,
      cpcLow: null,
      cpcHigh: null,
      cpcLowMicros: null,
      cpcHighMicros: null,
      monthlyVolumes: [],
    });
  });

  it('contains no secrets in the recorded payload', () => {
    // 只掃實際錄製資料（results），不掃人為 _meta 說明文字。
    const payload = JSON.stringify(fixture.results);
    expect(payload).not.toMatch(/developer|refresh|secret|api[_-]?key|token|password/i);
  });
});
