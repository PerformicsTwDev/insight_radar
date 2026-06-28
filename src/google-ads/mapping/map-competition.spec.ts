import { enums } from 'google-ads-api';
import { mapCompetition, mapCompetitionIndex } from './map-competition';

describe('mapCompetition (TC-4)', () => {
  it('maps the proto integer to the enum name via the package enums (no hardcoded ints)', () => {
    // 用套件 enums 反查：整數值 → 名稱（不硬編整數對照）。
    expect(mapCompetition(enums.KeywordPlanCompetitionLevel.LOW)).toBe('LOW');
    expect(mapCompetition(enums.KeywordPlanCompetitionLevel.MEDIUM)).toBe('MEDIUM');
    expect(mapCompetition(enums.KeywordPlanCompetitionLevel.HIGH)).toBe('HIGH');
    expect(mapCompetition(enums.KeywordPlanCompetitionLevel.UNSPECIFIED)).toBe('UNSPECIFIED');
    expect(mapCompetition(enums.KeywordPlanCompetitionLevel.UNKNOWN)).toBe('UNKNOWN');
  });

  it('passes through a string-name competition value unchanged', () => {
    expect(mapCompetition('HIGH')).toBe('HIGH');
    expect(mapCompetition('LOW')).toBe('LOW');
  });

  it('maps null / undefined / unrecognised value to UNSPECIFIED', () => {
    expect(mapCompetition(null)).toBe('UNSPECIFIED');
    expect(mapCompetition(undefined)).toBe('UNSPECIFIED');
    expect(mapCompetition(999)).toBe('UNSPECIFIED');
  });

  it('maps an invalid or wrong-case string to UNSPECIFIED (only exact enum names pass through)', () => {
    expect(mapCompetition('low')).toBe('UNSPECIFIED'); // 大小寫須完全相符
    expect(mapCompetition('foo')).toBe('UNSPECIFIED');
    expect(mapCompetition('')).toBe('UNSPECIFIED');
  });

  it('never depends on a hardcoded integer literal: LOW resolves to whatever the package assigns', () => {
    // 若套件改了整數值，本測試仍綠（因為用 enums 反查），但硬編 2→LOW 的實作會紅。
    const lowInt = enums.KeywordPlanCompetitionLevel.LOW;
    expect(mapCompetition(lowInt)).toBe('LOW');
  });
});

describe('mapCompetitionIndex (TC-4)', () => {
  it('passes through a 0–100 index', () => {
    expect(mapCompetitionIndex(0)).toBe(0);
    expect(mapCompetitionIndex(57)).toBe(57);
    expect(mapCompetitionIndex(100)).toBe(100);
  });

  it('maps missing index to null (not 0)', () => {
    expect(mapCompetitionIndex(null)).toBeNull();
    expect(mapCompetitionIndex(undefined)).toBeNull();
  });

  it('parses int64-as-string competition_index (gax longs:String); blank/non-finite → null', () => {
    expect(mapCompetitionIndex('88')).toBe(88);
    expect(mapCompetitionIndex('0')).toBe(0);
    expect(mapCompetitionIndex('')).toBeNull();
    expect(mapCompetitionIndex('   ')).toBeNull();
    expect(mapCompetitionIndex('abc')).toBeNull();
  });
});
