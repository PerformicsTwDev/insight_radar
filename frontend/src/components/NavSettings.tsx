import { useState, type ReactElement } from 'react';
import {
  SUPPORTED_GEOS,
  SUPPORTED_LANGUAGES,
  geoLabel,
  languageLabel,
  type LocaleOption,
} from '../lib/locale';
import { useAnalysisSettingsStore } from '../stores/analysisSettingsStore';

/**
 * Top-nav 分析設定 (T7.9, FR-1 修訂 / AC-1.3; T7.12 修訂³). A gear button showing the
 * active `geo · language` as **friendly labels**; clicking toggles a popover with two
 * curated `<select>` pickers. The stored/persisted **value is the Google Ads resource
 * name** (`geoTargetConstants/2158`) — the format the backend requires — while the option
 * text and the chip show the friendly label ({@link geoLabel}). Edits write the persisted
 * {@link useAnalysisSettingsStore} and are adopted by the create-analysis (FR-2 修訂);
 * `network` / `includeAdult` are fixed at the create call, so NOT surfaced. Tokens only.
 */
export function NavSettings(): ReactElement {
  const [open, setOpen] = useState(false);
  const geo = useAnalysisSettingsStore((s) => s.geo);
  const language = useAnalysisSettingsStore((s) => s.language);
  const setGeo = useAnalysisSettingsStore((s) => s.setGeo);
  const setLanguage = useAnalysisSettingsStore((s) => s.setLanguage);

  const FIELD_LABEL = 'block text-xs font-medium text-white/60';
  const SELECT_INPUT =
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
          {geoLabel(geo)} · {languageLabel(language)}
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
              <select
                id="settings-geo"
                value={geo}
                onChange={(e) => setGeo(e.target.value)}
                className={SELECT_INPUT}
              >
                <LocaleOptions options={SUPPORTED_GEOS} current={geo} />
              </select>
            </div>
            <div>
              <label htmlFor="settings-language" className={FIELD_LABEL}>
                語言 (language)
              </label>
              <select
                id="settings-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className={SELECT_INPUT}
              >
                <LocaleOptions options={SUPPORTED_LANGUAGES} current={language} />
              </select>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders the curated locale options. If the current stored value is not in the supported
 * set (e.g. a resource name from a history-row context we do not list), it is added as a
 * self-labelled option so the `<select>` stays controlled and never blanks the selection.
 */
function LocaleOptions({
  options,
  current,
}: {
  options: readonly LocaleOption[];
  current: string;
}): ReactElement {
  const known = options.some((o) => o.value === current);
  return (
    <>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {known ? null : <option value={current}>{current}</option>}
    </>
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
