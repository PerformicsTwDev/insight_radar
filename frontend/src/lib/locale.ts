/**
 * Locale registry (T7.12, FR-1 / AC-1.3 修訂³; Design §15). The canonical on-the-wire
 * representation of `geo` / `language` is the **Google Ads resource name**
 * (`geoTargetConstants/2158`, `languageConstants/1018`) — the format the backend contract
 * requires (`backend:Requirement`「geo/language 須為完整 resource name」; a friendly code
 * yields `InvalidArgument`). Friendly names (`台灣`, `繁體中文`) exist ONLY as display
 * labels in the {@link NavSettings} picker. NO React / no IO → core `src/lib/**` (≥90%).
 */

export interface LocaleOption {
  /** The Google Ads resource name sent to the backend. */
  readonly value: string;
  /** The friendly, user-facing display name. */
  readonly label: string;
}

/** Curated geo targets offered by the settings picker (value = Google Ads resource name). */
export const SUPPORTED_GEOS: readonly LocaleOption[] = [
  { value: 'geoTargetConstants/2158', label: '台灣' },
  { value: 'geoTargetConstants/2840', label: '美國' },
  { value: 'geoTargetConstants/2392', label: '日本' },
  { value: 'geoTargetConstants/2344', label: '香港' },
];

/** Curated languages offered by the settings picker (value = Google Ads resource name). */
export const SUPPORTED_LANGUAGES: readonly LocaleOption[] = [
  { value: 'languageConstants/1018', label: '繁體中文（台灣）' },
  { value: 'languageConstants/1000', label: 'English' },
  { value: 'languageConstants/1005', label: '日本語' },
  { value: 'languageConstants/1017', label: '简体中文' },
];

/**
 * Legacy friendly-code → resource name, used ONLY to migrate localStorage persisted by the
 * pre-T7.12 build (which stored `TW` / `zh-TW`). New writes always store resource names.
 */
const GEO_FRIENDLY: Readonly<Record<string, string>> = {
  TW: 'geoTargetConstants/2158',
  US: 'geoTargetConstants/2840',
  JP: 'geoTargetConstants/2392',
  HK: 'geoTargetConstants/2344',
};
const LANGUAGE_FRIENDLY: Readonly<Record<string, string>> = {
  'zh-TW': 'languageConstants/1018',
  en: 'languageConstants/1000',
  ja: 'languageConstants/1005',
  'zh-CN': 'languageConstants/1017',
};

/**
 * Normalise a stored/incoming geo to its resource name: a known friendly code is mapped, an
 * already-resolved resource name (or any unknown value) is returned as-is (best-effort, never
 * throws) so an unexpected localStorage value can never crash the picker.
 */
export function resolveGeo(value: string): string {
  return GEO_FRIENDLY[value] ?? value;
}

/** {@link resolveGeo} for the language dimension. */
export function resolveLanguage(value: string): string {
  return LANGUAGE_FRIENDLY[value] ?? value;
}

function labelOf(options: readonly LocaleOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** Friendly display for a geo resource name (falls back to the raw value when unknown). */
export function geoLabel(value: string): string {
  return labelOf(SUPPORTED_GEOS, value);
}

/** Friendly display for a language resource name (falls back to the raw value when unknown). */
export function languageLabel(value: string): string {
  return labelOf(SUPPORTED_LANGUAGES, value);
}
