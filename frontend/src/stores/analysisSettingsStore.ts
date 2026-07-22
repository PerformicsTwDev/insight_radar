import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { config } from '../config/env';

/**
 * Analysis settings (T7.9, FR-1 修訂 / AC-1.3) — the `geo` / `language` the Search
 * Insight create-analysis adopts (FR-2 修訂), edited in the top-nav {@link NavSettings}
 * and **persisted to localStorage** so they survive reloads / revisits. These are user
 * PREFERENCES, not secrets, so localStorage is appropriate (NFR-5 forbids localStorage
 * only for credentials). Defaults come from config (`VITE_DEFAULT_GEO` = `TW`,
 * `VITE_DEFAULT_LANGUAGE` = `zh-TW`). `network` / `includeAdult` are NOT settings — they
 * are fixed (`GOOGLE_SEARCH_AND_PARTNERS` / `true`) at the create call (FR-2 修訂 c).
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
      geo: config.defaultGeo,
      language: config.defaultLanguage,
      setGeo: (geo) => set({ geo }),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'ir.settings',
      // Persist only the values (not the setters); `geo`/`language` hydrate from
      // localStorage on load, falling back to the config defaults for a fresh visitor.
      partialize: (s) => ({ geo: s.geo, language: s.language }),
    },
  ),
);
