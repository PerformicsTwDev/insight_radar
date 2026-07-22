import { describe, expect, it } from 'vitest';
import {
  AI_CHANNEL_OPTIONS,
  EXPLORE_MODE_OPTIONS,
  INITIAL_AI_SEARCH_FORM,
  aiSearchKeywords,
  isAiSearchSubmittable,
  missingAiSearchFields,
  toBrandProfilePayload,
  toggleChannel,
  type AiSearchFormState,
} from './aiSearchForm';

/**
 * TC-61/TC-63 pure form logic (FR-22/FR-23). No React / no IO → core `src/lib/**`
 * (≥90% coverage gate). Mirrors the v4 `updateStartButtons` gate: brand name +
 * ≥1 alias + ≥1 site are always required; 搜尋詞 only in 指定模式; ≥1 抓取渠道.
 */

function full(overrides: Partial<AiSearchFormState> = {}): AiSearchFormState {
  return {
    exploreMode: 'brand',
    brand: {
      name: 'Dyson',
      aliases: ['戴森'],
      sites: ['https://www.dyson.tw'],
      competitors: [],
    },
    channels: ['chatGpt'],
    seedsRaw: '',
    ...overrides,
  };
}

describe('AI_CHANNEL_OPTIONS (v4 labels → extension-primary channel enum)', () => {
  it('maps the four v4 labels bijectively onto the extension-primary channels', () => {
    // extension is the primary pipeline (v3.4 invariant); SerpAPI enums are reserved.
    expect(AI_CHANNEL_OPTIONS.map((o) => o.label)).toEqual([
      'AI Overview',
      'AI Mode',
      'Gemini',
      'ChatGPT',
    ]);
    expect(AI_CHANNEL_OPTIONS.map((o) => o.value)).toEqual([
      'googleSearch',
      'googleAiMode',
      'geminiApp',
      'chatGpt',
    ]);
  });

  it('exposes the two AI-line explore modes (single-select pills)', () => {
    expect(EXPLORE_MODE_OPTIONS.map((o) => o.value)).toEqual(['brand', 'specified']);
    expect(EXPLORE_MODE_OPTIONS.map((o) => o.label)).toEqual(['品牌整體模式', '指定模式']);
  });
});

describe('missingAiSearchFields (缺項 hint, ordered)', () => {
  it('lists brand fields + channel when the form is empty (brand mode)', () => {
    expect(missingAiSearchFields(INITIAL_AI_SEARCH_FORM)).toEqual([
      '品牌名',
      '品牌別名',
      '品牌網站',
      '至少一個抓取渠道',
    ]);
  });

  it('treats a whitespace-only brand name as missing', () => {
    expect(missingAiSearchFields(full({ brand: { ...full().brand, name: '   ' } }))).toContain(
      '品牌名',
    );
  });

  it('requires 搜尋詞 only in 指定模式', () => {
    // brand mode: no seeds needed even when empty.
    expect(missingAiSearchFields(full({ exploreMode: 'brand', seedsRaw: '' }))).toEqual([]);
    // specified mode with empty seeds → 搜尋詞 missing (appended after brand, before nothing).
    expect(missingAiSearchFields(full({ exploreMode: 'specified', seedsRaw: '' }))).toEqual([
      '搜尋詞',
    ]);
    // specified mode with seeds → clean.
    expect(missingAiSearchFields(full({ exploreMode: 'specified', seedsRaw: 'a, b' }))).toEqual([]);
  });

  it('requires at least one 抓取渠道', () => {
    expect(missingAiSearchFields(full({ channels: [] }))).toEqual(['至少一個抓取渠道']);
  });

  it('is empty (submittable) when brand + ≥1 channel are present in brand mode', () => {
    expect(missingAiSearchFields(full())).toEqual([]);
    expect(isAiSearchSubmittable(full())).toBe(true);
    expect(isAiSearchSubmittable(INITIAL_AI_SEARCH_FORM)).toBe(false);
  });
});

describe('toggleChannel (multi-select, order-stable)', () => {
  it('adds a channel when absent and removes it when present', () => {
    expect(toggleChannel([], 'chatGpt')).toEqual(['chatGpt']);
    expect(toggleChannel(['googleSearch', 'chatGpt'], 'chatGpt')).toEqual(['googleSearch']);
    expect(toggleChannel(['googleSearch'], 'chatGpt')).toEqual(['googleSearch', 'chatGpt']);
  });
});

describe('toBrandProfilePayload (→ CreateBrandProfileDto)', () => {
  it('trims the brand name and passes alias/site chips through', () => {
    const payload = toBrandProfilePayload({
      name: '  Dyson  ',
      aliases: ['戴森'],
      sites: ['https://www.dyson.tw'],
      competitors: [],
    });
    expect(payload).toEqual({
      brand: { name: 'Dyson', aliases: ['戴森'], sites: ['https://www.dyson.tw'] },
      competitors: [],
    });
  });

  it('drops competitor rows whose name is blank and trims kept ones', () => {
    const payload = toBrandProfilePayload({
      name: 'Dyson',
      aliases: [],
      sites: [],
      competitors: [
        { name: '  ', aliases: ['x'], sites: [] }, // blank name → dropped
        { name: '  Shark ', aliases: ['夏克'], sites: ['shark.com'] },
      ],
    });
    expect(payload.competitors).toEqual([
      { name: 'Shark', aliases: ['夏克'], sites: ['shark.com'] },
    ]);
  });
});

describe('aiSearchKeywords (submit payload keywords)', () => {
  it('parses the seeds textarea in 指定模式', () => {
    expect(aiSearchKeywords(full({ exploreMode: 'specified', seedsRaw: 'a\nb, c' }))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('derives the brand + competitor universe in 品牌整體模式 (deduped, C7)', () => {
    const keywords = aiSearchKeywords(
      full({
        exploreMode: 'brand',
        brand: {
          name: 'Dyson',
          aliases: ['戴森', 'DYSON'], // "DYSON" de-dupes against "Dyson" (case, C7)
          sites: ['https://www.dyson.tw'],
          competitors: [{ name: 'Shark', aliases: ['夏克'], sites: [] }],
        },
      }),
    );
    expect(keywords).toEqual(['Dyson', '戴森', 'Shark', '夏克']);
  });

  it('always yields ≥1 keyword in brand mode (backend ArrayNotEmpty) when name is set', () => {
    const keywords = aiSearchKeywords(
      full({
        exploreMode: 'brand',
        brand: { name: 'Dyson', aliases: [], sites: ['x'], competitors: [] },
      }),
    );
    expect(keywords).toEqual(['Dyson']);
  });
});
