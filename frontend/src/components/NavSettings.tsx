import { useState, type ReactElement } from 'react';
import { useAnalysisSettingsStore } from '../stores/analysisSettingsStore';

/**
 * Top-nav 分析設定 (T7.9, FR-1 修訂 / AC-1.3). A gear button showing the active
 * `geo · language`; clicking toggles a popover with the two fields. Edits write the
 * persisted {@link useAnalysisSettingsStore} (localStorage) and are adopted by the
 * Search Insight create-analysis (FR-2 修訂) — `network` / `includeAdult` are fixed at
 * the create call, so they are NOT surfaced here. Tokens only (no hardcoded hex).
 */
export function NavSettings(): ReactElement {
  const [open, setOpen] = useState(false);
  const geo = useAnalysisSettingsStore((s) => s.geo);
  const language = useAnalysisSettingsStore((s) => s.language);
  const setGeo = useAnalysisSettingsStore((s) => s.setGeo);
  const setLanguage = useAnalysisSettingsStore((s) => s.setLanguage);

  const FIELD_LABEL = 'block text-xs font-medium text-white/60';
  const TEXT_INPUT =
    'mt-1 w-full rounded-lg bg-bg-input px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-brand';

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="分析設定"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-white/70 ring-1 ring-white/10 hover:text-white hover:ring-white/20"
      >
        <GearIcon />
        <span className="text-xs text-white/50">
          {geo} · {language}
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="分析設定"
          className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-white/10 bg-bg-card p-4 shadow-xl"
        >
          <p className="mb-3 text-xs text-white/40">建立分析時採用的地區與語言（自動記住）。</p>
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor="settings-geo" className={FIELD_LABEL}>
                地區 (geo)
              </label>
              <input
                id="settings-geo"
                type="text"
                value={geo}
                onChange={(e) => setGeo(e.target.value)}
                className={TEXT_INPUT}
                placeholder="TW"
              />
            </div>
            <div>
              <label htmlFor="settings-language" className={FIELD_LABEL}>
                語言 (language)
              </label>
              <input
                id="settings-language"
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className={TEXT_INPUT}
                placeholder="zh-TW"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Inline gear affordance for the 分析設定 toggle (decorative; the button is labelled). */
function GearIcon(): ReactElement {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <circle cx="12" cy="12" r="3" strokeWidth="2" />
    </svg>
  );
}
