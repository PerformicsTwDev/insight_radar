import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { config } from '../config/env';
import { resolveGeo, resolveLanguage } from '../lib/locale';

/**
 * Analysis settings (T7.9, FR-1 修訂 / AC-1.3) — the `geo` / `language` the Search
 * Insight create-analysis adopts (FR-2 修訂), edited in the top-nav {@link NavSettings}
 * and **persisted to localStorage** so they survive reloads / revisits. These are user
 * PREFERENCES, not secrets, so localStorage is appropriate (NFR-5 forbids localStorage
 * only for credentials).
 *
 * **T7.12 (AC-1.3 修訂³):** the stored values are **Google Ads resource names**
 * (`geoTargetConstants/2158`, `languageConstants/1018`) — the format the backend contract
 * requires — not friendly codes. Defaults come from config (now resource names). A pre-T7.12
 * localStorage holding a friendly code (`TW` / `zh-TW`) is normalised on rehydrate via
 * {@link resolveGeo} / {@link resolveLanguage} (persist `version` bump + `migrate`).
 * `network` / `includeAdult` are NOT settings — they are fixed at the create call (FR-2 修訂 c).
 */
export interface AnalysisSettingsState {
  readonly geo: string;
  readonly language: string;
  setGeo: (geo: string) => void;
  setLanguage: (language: string) => void;
}

export const useAnalysisSettingsStore = create<AnalysisSettingsState>()(
  persist(
    (set) => ({
      // Resolve the config defaults too: a stale local `.env` (`VITE_DEFAULT_GEO=TW`) must
      // still yield a resource name, so the store's "geo is always a resource name" invariant
      // holds for a fresh visitor, not just for migrated persisted state.
      geo: resolveGeo(config.defaultGeo),
      language: resolveLanguage(config.defaultLanguage),
      setGeo: (geo) => set({ geo }),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'ir.settings',
      // Persist only the values (not the setters); `geo`/`language` hydrate from
      // localStorage on load, falling back to the config defaults for a fresh visitor.
      partialize: (s) => ({ geo: s.geo, language: s.language }),
      // T7.12: bump so a version-less (pre-T7.12) persisted state runs `migrate`, mapping any
      // legacy friendly code to its resource name. `resolve*` is idempotent for resource names.
      version: 1,
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<Pick<AnalysisSettingsState, 'geo' | 'language'>>;
        return {
          geo: resolveGeo(s.geo ?? config.defaultGeo),
          language: resolveLanguage(s.language ?? config.defaultLanguage),
        };
      },
    },
  ),
);
