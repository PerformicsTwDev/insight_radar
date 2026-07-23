import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_GEOS,
  SUPPORTED_LANGUAGES,
  geoLabel,
  languageLabel,
  resolveGeo,
  resolveLanguage,
} from './locale';

describe('lib/locale (T7.12, TC-75) — friendly ⇄ Google Ads resource name', () => {
  it('maps legacy friendly codes to resource names (localStorage migrate)', () => {
    expect(resolveGeo('TW')).toBe('geoTargetConstants/2158');
    expect(resolveLanguage('zh-TW')).toBe('languageConstants/1018');
  });

  it('passes an already-resolved resource name through unchanged (idempotent)', () => {
    expect(resolveGeo('geoTargetConstants/2158')).toBe('geoTargetConstants/2158');
    expect(resolveLanguage('languageConstants/1018')).toBe('languageConstants/1018');
  });

  it('returns an unknown value as-is (best-effort, never throws)', () => {
    expect(resolveGeo('geoTargetConstants/9999')).toBe('geoTargetConstants/9999');
    expect(resolveLanguage('klingon')).toBe('klingon');
  });

  it('every supported option value is a resource name, never a friendly code', () => {
    expect(SUPPORTED_GEOS.length).toBeGreaterThan(0);
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThan(0);
    for (const o of SUPPORTED_GEOS) expect(o.value).toMatch(/^geoTargetConstants\/\d+$/);
    for (const o of SUPPORTED_LANGUAGES) expect(o.value).toMatch(/^languageConstants\/\d+$/);
  });

  it('exposes Taiwan / Traditional-Chinese as the default supported locale', () => {
    expect(
      SUPPORTED_GEOS.some((o) => o.value === 'geoTargetConstants/2158' && o.label === '台灣'),
    ).toBe(true);
    expect(SUPPORTED_LANGUAGES.some((o) => o.value === 'languageConstants/1018')).toBe(true);
  });

  it('labels a resource name with its friendly display, falling back to the raw value', () => {
    expect(geoLabel('geoTargetConstants/2158')).toBe('台灣');
    expect(languageLabel('languageConstants/1018')).toBe('繁體中文（台灣）');
    expect(geoLabel('geoTargetConstants/9999')).toBe('geoTargetConstants/9999'); // fallback
    expect(languageLabel('klingon')).toBe('klingon'); // fallback
  });
});
