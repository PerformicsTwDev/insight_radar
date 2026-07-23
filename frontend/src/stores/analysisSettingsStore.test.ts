import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config/env';
import { useAnalysisSettingsStore } from './analysisSettingsStore';

/**
 * TC-72 (T7.9) / TC-75 (T7.12, FR-1 修訂 / AC-1.3³) — the persisted analysis settings store.
 * The stored `geo` / `language` are **Google Ads resource names** (the backend contract),
 * defaulting to config (台灣 / 繁中 resource names); edits persist to localStorage
 * (`ir.settings`). A pre-T7.12 friendly code (`TW` / `zh-TW`) is migrated on rehydrate.
 */
describe('TC-72/TC-75 · analysisSettingsStore (persisted geo/language = resource name)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAnalysisSettingsStore.setState({
      geo: config.defaultGeo,
      language: config.defaultLanguage,
    });
  });

  it('defaults to the config geo/language as Google Ads resource names', () => {
    expect(useAnalysisSettingsStore.getState().geo).toBe('geoTargetConstants/2158');
    expect(useAnalysisSettingsStore.getState().language).toBe('languageConstants/1018');
  });

  it('setGeo / setLanguage update the state and persist to localStorage', () => {
    useAnalysisSettingsStore.getState().setGeo('geoTargetConstants/2840');
    useAnalysisSettingsStore.getState().setLanguage('languageConstants/1000');

    expect(useAnalysisSettingsStore.getState().geo).toBe('geoTargetConstants/2840');
    expect(useAnalysisSettingsStore.getState().language).toBe('languageConstants/1000');

    const persisted = JSON.parse(localStorage.getItem('ir.settings') ?? '{}') as {
      state?: { geo?: string; language?: string };
    };
    expect(persisted.state).toMatchObject({
      geo: 'geoTargetConstants/2840',
      language: 'languageConstants/1000',
    });
  });

  it('migrates a legacy friendly-code persisted by the pre-T7.12 build (TW/zh-TW → resource name)', async () => {
    // Simulate old localStorage: version-less friendly codes from before T7.12.
    localStorage.setItem(
      'ir.settings',
      JSON.stringify({ state: { geo: 'TW', language: 'zh-TW' }, version: 0 }),
    );
    await useAnalysisSettingsStore.persist.rehydrate();

    expect(useAnalysisSettingsStore.getState().geo).toBe('geoTargetConstants/2158');
    expect(useAnalysisSettingsStore.getState().language).toBe('languageConstants/1018');
  });

  it('falls back to the config default when a persisted state has no geo/language', async () => {
    localStorage.setItem('ir.settings', JSON.stringify({ state: {}, version: 0 }));
    await useAnalysisSettingsStore.persist.rehydrate();

    expect(useAnalysisSettingsStore.getState().geo).toBe('geoTargetConstants/2158');
    expect(useAnalysisSettingsStore.getState().language).toBe('languageConstants/1018');
  });

  it('tolerates a corrupted persisted item with no state key (migrate never throws)', async () => {
    localStorage.setItem('ir.settings', JSON.stringify({ version: 0 }));
    await useAnalysisSettingsStore.persist.rehydrate();

    expect(useAnalysisSettingsStore.getState().geo).toBe('geoTargetConstants/2158');
    expect(useAnalysisSettingsStore.getState().language).toBe('languageConstants/1018');
  });
});
