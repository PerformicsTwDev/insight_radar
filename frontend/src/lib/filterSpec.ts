/**
 * T2.5 red shell (FR-6, Design §6 C4). Full public type surface so the TC-3/4/17
 * specs typecheck; function bodies are typed not-implemented stubs so the tests
 * fail on assertions (red), not on a missing module. Implemented green next.
 */

export type IntentMode = 'any' | 'all';

export interface FilterSpec {
  readonly volumeMin?: number;
  readonly volumeMax?: number;
  readonly q?: string;
  readonly intent?: readonly string[];
  readonly intentMode?: IntentMode;
  readonly competition?: readonly string[];
  readonly competitionIndexMin?: number;
  readonly competitionIndexMax?: number;
  readonly cpcMin?: number;
  readonly cpcMax?: number;
}

export type InexFieldKey = 'keyword';
export type RangeFieldKey = 'volume' | 'competitionIndex' | 'cpc';
export type OptionsFieldKey = 'intent' | 'competition';
export type MenuKwFieldKey = 'intentTopic' | 'journeyTopic' | 'customTopic';
export type FilterFieldKey = InexFieldKey | RangeFieldKey | OptionsFieldKey | MenuKwFieldKey;

export interface InexChip {
  readonly type: 'inex';
  readonly field: InexFieldKey;
  readonly include?: string;
  readonly exclude?: string;
}
export interface RangeChip {
  readonly type: 'range';
  readonly field: RangeFieldKey;
  readonly min?: number;
  readonly max?: number;
}
export interface OptionsChip {
  readonly type: 'options';
  readonly field: OptionsFieldKey;
  readonly values: readonly string[];
  readonly mode?: IntentMode;
}
export interface MenuKwChip {
  readonly type: 'menukw';
  readonly field: MenuKwFieldKey;
  readonly topic?: string;
  readonly keyword?: string;
}
export type Chip = InexChip | RangeChip | OptionsChip | MenuKwChip;

const NOT_IMPLEMENTED = 'filterSpec: not implemented (T2.5 red)';

export function chipsToSpec(_chips: readonly Chip[]): FilterSpec {
  throw new Error(NOT_IMPLEMENTED);
}

export function specToChips(_spec: FilterSpec): Chip[] {
  throw new Error(NOT_IMPLEMENTED);
}

export function serializeFiltersToUrl(_spec: FilterSpec): string {
  throw new Error(NOT_IMPLEMENTED);
}

export function deserializeFiltersFromUrl(_raw: unknown): FilterSpec {
  throw new Error(NOT_IMPLEMENTED);
}

export function applyChip(_spec: FilterSpec, _chip: Chip): FilterSpec {
  throw new Error(NOT_IMPLEMENTED);
}

export function clearField(_spec: FilterSpec, _field: FilterFieldKey): FilterSpec {
  throw new Error(NOT_IMPLEMENTED);
}

export function isValidRange(_min: number | undefined, _max: number | undefined): boolean {
  throw new Error(NOT_IMPLEMENTED);
}
