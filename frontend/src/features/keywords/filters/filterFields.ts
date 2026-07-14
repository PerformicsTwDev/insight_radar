import { intentMap } from '../../../lib/intentMap';
import { COMPETITION_ZH } from '../../../lib/keywordsTable';
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

export interface FilterFieldDef {
  readonly type: FilterFieldType;
  readonly label: string;
  readonly options?: readonly FilterOption[];
  /** range fields: render bounds as money (NT$) vs plain numbers. */
  readonly money?: boolean;
  readonly includePlaceholder?: string;
  readonly excludePlaceholder?: string;
}

// Intent options derive their zh from the intentMap SSOT (C2) — no zh drift.
const INTENT_OPTIONS: readonly FilterOption[] = (
  ['informational', 'commercial', 'transactional', 'navigational'] as const
).map((value) => ({ value, label: intentMap[value].zh }));

// Competition options reuse the single 高/中/低 source (keywordsTable COMPETITION_ZH).
const COMPETITION_OPTIONS: readonly FilterOption[] = (['HIGH', 'MEDIUM', 'LOW'] as const).map(
  (value) => ({ value, label: COMPETITION_ZH[value] }),
);

export const FILTER_FIELDS: Readonly<Record<FilterFieldKey, FilterFieldDef>> = {
  keyword: {
    type: 'inex',
    label: '搜尋詞',
    includePlaceholder: '包含字，例如：寵物',
    excludePlaceholder: '不包含字，例如：二手',
  },
  intent: { type: 'options', label: '意圖類別', options: INTENT_OPTIONS },
  competition: { type: 'options', label: '競爭度', options: COMPETITION_OPTIONS },
  volume: { type: 'range', label: '搜尋量' },
  competitionIndex: { type: 'range', label: '競爭度指數' },
  cpc: { type: 'range', label: 'CPC', money: true },
  // menukw (主題+關鍵字) — view-router grouping dimensions (M3+); no base FilterSpec field.
  intentTopic: { type: 'menukw', label: '意圖主題', options: [] },
  journeyTopic: { type: 'menukw', label: '購買歷程主題', options: [] },
  customTopic: { type: 'menukw', label: '自訂分類', options: [] },
};

/**
 * Filters offered on the base 搜尋詞總表 view — the backend-representable FilterSpec
 * fields (`competitionIndex` is codec-complete for shared URLs but not offered by
 * default, matching the mockup, which exposes competition as an enum options chip).
 */
export const DEFAULT_ALLOWED_FILTERS: readonly FilterFieldKey[] = [
  'keyword',
  'intent',
  'competition',
  'volume',
  'cpc',
];
