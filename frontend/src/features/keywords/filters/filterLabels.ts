import type {
  Chip,
  FilterFieldKey,
  InexFieldKey,
  MenuKwFieldKey,
  OptionsFieldKey,
  RangeFieldKey,
} from '../../../lib/filterSpec';
import type { FilterFieldDef } from './filterFields';

/**
 * Pure chip input→Chip + Chip→zh-label helpers for the filter bar (T2.5, FR-6).
 * **No React** — extracted from `FilterBar` so every branch (incl. defensive
 * fallbacks) is exhaustively unit-testable and the component file exports only a
 * component (react-refresh). The chip↔spec mapping itself lives in
 * `lib/filterSpec` (C4); this is only the popover-input assembly + display label.
 */

/** The popover's raw inputs, assembled into a typed {@link Chip} by {@link buildChip}. */
export interface ChipInputs {
  readonly include: string;
  readonly minText: string;
  readonly maxText: string;
  readonly selected: readonly string[];
  readonly topic: string;
  readonly keyword: string;
  readonly current: Chip | undefined;
}

/** Build the typed `Chip` for a field from the popover's raw inputs. */
export function buildChip(field: FilterFieldKey, def: FilterFieldDef, i: ChipInputs): Chip {
  switch (def.type) {
    case 'inex':
      // Include-only at M2: the backend `q` has no NOT capability (backend #416).
      return {
        type: 'inex',
        field: field as InexFieldKey,
        include: i.include.trim(),
      };
    case 'range':
      return {
        type: 'range',
        field: field as RangeFieldKey,
        min: parseNum(i.minText),
        max: parseNum(i.maxText),
      };
    case 'options':
      return {
        type: 'options',
        field: field as OptionsFieldKey,
        values: i.selected,
        // preserve an existing intentMode across edits (the UI is any-only, mockup parity).
        mode: i.current?.type === 'options' ? i.current.mode : undefined,
      };
    default:
      return {
        type: 'menukw',
        field: field as MenuKwFieldKey,
        topic: i.topic.trim() || undefined,
        keyword: i.keyword.trim() || undefined,
      };
  }
}

/** The popover input values seeded when a field's chip is (re)opened. */
export interface PopoverSeed {
  readonly include: string;
  readonly minText: string;
  readonly maxText: string;
  readonly selected: readonly string[];
  readonly topic: string;
  readonly keyword: string;
}

/**
 * Seed the popover inputs from the chip currently applied to a field so an opened
 * chip reflects live state (the reverse of {@link buildChip}). `menukw` (the topic
 * view-router dimension) never round-trips from the flat FilterSpec at M2 —
 * `specToChips` never yields a menukw chip — so topic/keyword seed to `''`
 * unconditionally here; M3 (T3.x) wires the topic view-router state. Extracted from
 * the component so every seed branch (incl. the defensive `?? ''` fallbacks for an
 * include-absent inex chip) is exhaustively unit-testable and `FilterBar` exports
 * only a component (react-refresh).
 */
export function popoverSeed(current: Chip | undefined): PopoverSeed {
  const inex = current?.type === 'inex' ? current : undefined;
  const range = current?.type === 'range' ? current : undefined;
  return {
    include: inex?.include ?? '',
    minText: range?.min !== undefined ? String(range.min) : '',
    maxText: range?.max !== undefined ? String(range.max) : '',
    selected: current?.type === 'options' ? current.values : [],
    topic: '',
    keyword: '',
  };
}

/** Parse a numeric input: blank → undefined; non-finite → undefined (codec drops it too). */
export function parseNum(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** Toggle a value in a multi-select set (add if absent, remove if present). */
export function toggleValue(values: readonly string[], value: string): readonly string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/** The zh chip label showing the current selection (or 不限 when unset). */
export function valueLabel(current: Chip | undefined, def: FilterFieldDef): string {
  if (current === undefined) {
    return '不限';
  }
  if (current.type === 'range') {
    return rangeLabel(current.min, current.max, def.money === true);
  }
  if (current.type === 'options') {
    return current.values.map((v) => optionLabel(def, v)).join('、');
  }
  // inex is the only remaining chip a FilterSpec can produce (menukw never round-trips
  // from the flat spec, so its label is only ever the unset 不限 above); its include
  // is the non-empty q.
  return current.type === 'inex' ? `含 ${current.include ?? ''}` : '不限';
}

/** Range chip label: `min–max` / `min+` / `≤max` (money prefixes NT$). */
export function rangeLabel(
  min: number | undefined,
  max: number | undefined,
  money: boolean,
): string {
  const fmt = (n: number): string => (money ? `NT$${n}` : String(n));
  if (min !== undefined && max !== undefined) {
    return `${fmt(min)}–${fmt(max)}`;
  }
  if (min !== undefined) {
    return `${fmt(min)}+`;
  }
  return `≤${fmt(max ?? 0)}`;
}

/** Resolve an option value to its zh label (raw value when unknown — e.g. a stale URL value). */
export function optionLabel(def: FilterFieldDef, value: string): string {
  return (def.options ?? []).find((o) => o.value === value)?.label ?? value;
}
