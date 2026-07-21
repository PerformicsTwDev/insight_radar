import { describe, expect, it } from 'vitest';
import type { KeywordRow } from '../api/keywords';
import { KEYWORDS_TSV_HEADERS, keywordsToTsv } from './keywordsTsv';

/**
 * TC-6 (FR-13) — the 搜尋詞總表 TSV export built on the pure `lib/tsv` primitives. Raw
 * values are exported (null → empty cell, never 0 or "—", C12); intent labels resolve to
 * the C2 zh SSOT; competition uses the shared 高/中/低 map with a raw fallback.
 */

function row(overrides: Partial<KeywordRow> = {}): KeywordRow {
  return {
    text: 'running shoes',
    intentLabels: ['commercial'],
    avgMonthlySearches: 12000,
    competition: 'HIGH',
    competitionIndex: 88,
    cpcLow: 1.2,
    cpcHigh: 3.4,
    monthlyVolumes: [],
    ...overrides,
  };
}

describe('keywordsToTsv', () => {
  it('emits a header row then one tab-separated row per keyword (raw values)', () => {
    const tsv = keywordsToTsv([row()]);
    const [header, first] = tsv.split('\n');
    expect(header).toBe(KEYWORDS_TSV_HEADERS.join('\t'));
    // 搜尋詞 / 意圖(zh) / 搜尋量 / 競爭度(zh) / 競爭度指數 / CPC最低 / CPC最高
    expect(first).toBe(['running shoes', '商業型', '12000', '高', '88', '1.2', '3.4'].join('\t'));
  });

  it('keeps null metrics as empty cells (missing ≠ 0, C12) and empty intent as blank', () => {
    const tsv = keywordsToTsv([
      row({
        text: '缺值列',
        intentLabels: [],
        avgMonthlySearches: null,
        competition: 'LOW',
        competitionIndex: null,
        cpcLow: null,
        cpcHigh: null,
      }),
    ]);
    const cells = tsv.split('\n')[1].split('\t');
    expect(cells).toEqual(['缺值列', '', '', '低', '', '', '']);
  });

  it('maps unknown intent labels / competition through untouched (raw fallback)', () => {
    const tsv = keywordsToTsv([
      row({ intentLabels: ['mystery'], competition: 'UNSPECIFIED', competitionIndex: null }),
    ]);
    const cells = tsv.split('\n')[1].split('\t');
    expect(cells[1]).toBe('mystery');
    expect(cells[3]).toBe('UNSPECIFIED');
  });

  it('joins multiple intent labels with the 、 separator', () => {
    const tsv = keywordsToTsv([row({ intentLabels: ['commercial', 'transactional'] })]);
    expect(tsv.split('\n')[1].split('\t')[1]).toBe('商業型、交易型');
  });
});
