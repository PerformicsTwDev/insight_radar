import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config/env';
import { useAnalysisSettingsStore } from './analysisSettingsStore';

/**
 * TC-72 (T7.9, FR-1 修訂 / AC-1.3) — the persisted analysis settings store. Defaults to
 * the config geo/language (`TW` / `zh-TW`); edits persist to localStorage (`ir.settings`)
 * so they survive reloads. geo/language are preferences (not secrets) → localStorage OK.
 */
describe('TC-72 · analysisSettingsStore (persisted geo/language)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAnalysisSettingsStore.setState({
      geo: config.defaultGeo,
      language: config.defaultLanguage,
    });
  });

  it('defaults to the config geo/language (TW / zh-TW)', () => {
    expect(useAnalysisSettingsStore.getState().geo).toBe('TW');
    expect(useAnalysisSettingsStore.getState().language).toBe('zh-TW');
  });

  it('setGeo / setLanguage update the state and persist to localStorage', () => {
    useAnalysisSettingsStore.getState().setGeo('US');
    useAnalysisSettingsStore.getState().setLanguage('en');

    expect(useAnalysisSettingsStore.getState().geo).toBe('US');
    expect(useAnalysisSettingsStore.getState().language).toBe('en');

    const persisted = JSON.parse(localStorage.getItem('ir.settings') ?? '{}') as {
      state?: { geo?: string; language?: string };
    };
    expect(persisted.state).toMatchObject({ geo: 'US', language: 'en' });
  });
});
