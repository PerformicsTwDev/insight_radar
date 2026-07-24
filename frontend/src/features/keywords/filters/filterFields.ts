import { intentMap } from '../../../lib/intentMap';
import { COMPETITION_ZH } from '../../../lib/keywordsTable';
import { TREND_TYPE_ZH } from '../../../lib/trend';
import type { FilterFieldKey } from '../../../lib/filterSpec';

/**
 * UI-facing filter definitions (T2.5, FR-6) — mirrors the mockup's `getFilterDef`
 * (uiux v4 `Search Insight` view). Each backend-representable field is bound to
 * one of the four chip TYPES (inex / range / options / menukw). The chip data
 * model (see `lib/filterSpec`) stores **backend-native values** (enums / raw
 * text / numbers); this registry only supplies the zh labels + option sets the
 * component renders. Intent zh comes from the C2 SSOT (`intentMap`) and
 * competition zh from the shared `COMPETITION_ZH` — so labels can never drift.
 */

export type FilterFieldType = 'inex' | 'range' | 'options' | 'menukw';

export interface FilterOption {
  /** backend enum value stored in the chip (e.g. `informational`, `HIGH`). */
  readonly value: string;
  /** zh label shown in the popover. */
  readonly label: string;
}

interface FilterFieldDefBase {
  readonly label: string;
  /** range fields: render bounds as money (NT$) vs plain numbers. */
  readonly money?: boolean;
  readonly includePlaceholder?: string;
}

/**
 * `options` / `menukw` fields ALWAYS carry an options list (empty for menukw at M2
 * until T3.x wires the topic dimensions). Making it required on this variant lets
 * the popover render `def.options` without a defensive `?? []` fallback.
 */
export interface OptionsFieldDef extends FilterFieldDefBase {
  readonly type: 'options' | 'menukw';
  readonly options: readonly FilterOption[];
}

/** `inex` / `range` fields never carry an options list. */
export interface PlainFieldDef extends FilterFieldDefBase {
  readonly type: 'inex' | 'range';
  readonly options?: undefined;
}

/**
 * Discriminated on `type`: `def.type === 'options'` narrows to {@link OptionsFieldDef}
 * (options guaranteed), so the chip popover never needs a dead `options ?? []` fallback.
 */
export type FilterFieldDef = OptionsFieldDef | PlainFieldDef;

// Intent options derive their zh from the intentMap SSOT (C2) — no zh drift.
const INTENT_OPTIONS: readonly FilterOption[] = (
  ['informational', 'commercial', 'transactional', 'navigational'] as const
).map((value) => ({ value, label: intentMap[value].zh }));

// Competition options reuse the single 高/中/低 source (keywordsTable COMPETITION_ZH).
const COMPETITION_OPTIONS: readonly FilterOption[] = (['HIGH', 'MEDIUM', 'LOW'] as const).map(
  (value) => ({ value, label: COMPETITION_ZH[value] }),
);

// 搜尋趨勢 options reuse the TREND_TYPE_ZH SSOT (回落/穩定/成長/爆發). Prototype order: 穩定→回落.
const TREND_OPTIONS: readonly FilterOption[] = (
  ['stable', 'growth', 'surge', 'decline'] as const
).map((value) => ({ value, label: TREND_TYPE_ZH[value] }));

export const FILTER_FIELDS: Readonly<Record<FilterFieldKey, FilterFieldDef>> = {
  keyword: {
    type: 'inex',
    label: '搜尋詞',
    includePlaceholder: '包含字，例如：寵物',
  },
  intent: { type: 'options', label: '意圖類別', options: INTENT_OPTIONS },
  competition: { type: 'options', label: '競爭度', options: COMPETITION_OPTIONS },
  volume: { type: 'range', label: '搜尋量' },
  competitionIndex: { type: 'range', label: '競爭度指數' },
  cpc: { type: 'range', label: 'CPC', money: true },
  // v4 display chips (M7-R17): trend = 搜尋趨勢型別 options; aiIntent = 包含字 inex. Neither is a
  // base FilterSpec field (chipsToSpec ignores them) — visual until backend filter support (#777).
  trend: { type: 'options', label: '搜尋趨勢', options: TREND_OPTIONS },
  aiIntent: { type: 'inex', label: 'AI 歸納搜尋意圖', includePlaceholder: '包含字，例如：推薦' },
  // menukw (主題+關鍵字) — view-router grouping dimensions (M3+); no base FilterSpec field.
  intentTopic: { type: 'menukw', label: '意圖主題', options: [] },
  journeyTopic: { type: 'menukw', label: '購買歷程主題', options: [] },
  customTopic: { type: 'menukw', label: '自訂分類', options: [] },
};

/**
 * Filters offered on the base 搜尋詞總表 view (M7-R17 v4 fidelity) — the prototype's
 * `VIEW_FILTERS.all` chip set, in order. `keyword / intent / volume / competition / cpc`
 * are backend-representable (feed the `FilterSpec`); `intentTopic / journeyTopic` are
 * view-router grouping dimensions (menukw display chips, no base `FilterSpec` field).
 * `trend` + `aiIntent` (the remaining two prototype chips) need new non-`FilterSpec`
 * display-chip infra + backend filter support (see #777) and are added next.
 * `competitionIndex` stays codec-complete for shared URLs but off the default bar
 * (the prototype exposes 競爭度 as an enum chip, not a competitionIndex range).
 */
export const DEFAULT_ALLOWED_FILTERS: readonly FilterFieldKey[] = [
  'keyword',
  'intent',
  'intentTopic',
  'journeyTopic',
  'trend',
  'volume',
  'competition',
  'cpc',
  'aiIntent',
];
