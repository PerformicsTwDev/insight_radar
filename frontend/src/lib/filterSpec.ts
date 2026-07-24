import { z } from 'zod';

/**
 * The ONE bidirectional chips ↔ FilterSpec ↔ URL codec (T2.5, FR-6, Design §6 C4).
 * This is the single place that mapping may live, so the filter UI, the
 * `/keywords` + `/query` `filters`, and the shareable URL can never drift apart
 * (a three-way, three-consistent serialization). Pure `core` lib — **no React /
 * no IO** — so it is exhaustively unit-testable and hits the ≥90% core gate.
 *
 * `FilterSpec` is **backend-exact** (mirrors `src/keywords/filter-spec.ts` +
 * `FilterSpecDto`): the flat set of fields the backend `buildPredicate` honours.
 * The global backend ValidationPipe is `whitelist + forbidNonWhitelisted`, so an
 * unknown field is a 400 — the type therefore carries **only** these fields, and
 * anything the UI could express but the backend can't (a topic dimension) is a
 * documented gap, never an invented field (#392 class).
 *
 * Semantics (FR-6): multiple filters combine as **AND**; the options within one
 * filter are an **OR** set; `min>max` ranges and empty terms are dropped so an
 * impossible/empty filter never reaches the backend; a `FilterSpec → chips →
 * FilterSpec` round-trip and a `serialize ↔ deserialize` round-trip are the
 * identity.
 */

// ── Canonical FilterSpec (backend-exact) ─────────────────────────────────────
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

// ── Chip UI model (the four chip types) ──────────────────────────────────────
// `aiIntent` (inex) + `trend` (options) are v4 display chips (M7-R17): they reuse the
// inex/options bodies but carry no base FilterSpec field — the backend can't filter by
// AI-summarised intent or trend type (see #777). `chipsToSpec` deliberately ignores them,
// so, like `menukw`, they never round-trip and stay visual until backend support lands.
export type InexFieldKey = 'keyword' | 'aiIntent';
export type RangeFieldKey = 'volume' | 'competitionIndex' | 'cpc';
export type OptionsFieldKey = 'intent' | 'competition' | 'trend';
export type MenuKwFieldKey = 'intentTopic' | 'journeyTopic' | 'customTopic';
export type FilterFieldKey = InexFieldKey | RangeFieldKey | OptionsFieldKey | MenuKwFieldKey;

/**
 * `inex` — include text (backend-native raw text). Include-only at M2: the backend
 * `q` is a case-insensitive contains with no NOT capability, so an exclude term
 * would be a decorative no-op — deferred to M2+ (backend #416, FR-6 / Design §6 C4).
 */
export interface InexChip {
  readonly type: 'inex';
  readonly field: InexFieldKey;
  readonly include?: string;
}
/** `range` — min / max numeric bounds. */
export interface RangeChip {
  readonly type: 'range';
  readonly field: RangeFieldKey;
  readonly min?: number;
  readonly max?: number;
}
/** `options` — multi-select OR set (enum values, not zh labels). */
export interface OptionsChip {
  readonly type: 'options';
  readonly field: OptionsFieldKey;
  readonly values: readonly string[];
  readonly mode?: IntentMode;
}
/** `menukw` — 主題 + 關鍵字 menu (view-router grouping dimension; not a base FilterSpec field). */
export interface MenuKwChip {
  readonly type: 'menukw';
  readonly field: MenuKwFieldKey;
  readonly topic?: string;
  readonly keyword?: string;
}
export type Chip = InexChip | RangeChip | OptionsChip | MenuKwChip;

// ── Normalisation (single canonicalisation point) ────────────────────────────

/** Loosely-typed pre-normalisation shape both the chip fold and the URL parse funnel through. */
interface RawFilterInput {
  volumeMin?: number;
  volumeMax?: number;
  q?: string;
  intent?: readonly string[];
  intentMode?: IntentMode;
  competition?: readonly string[];
  competitionIndexMin?: number;
  competitionIndexMax?: number;
  cpcMin?: number;
  cpcMax?: number;
}

type MutableSpec = { -readonly [K in keyof FilterSpec]: FilterSpec[K] };

/** True unless both bounds are set and `min>max` (open / equal / unset bounds are valid). */
export function isValidRange(min: number | undefined, max: number | undefined): boolean {
  return !(isFiniteNumber(min) && isFiniteNumber(max) && min > max);
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A finite bound, or undefined. Guards against NaN / non-numbers reaching the backend. */
function finiteOrUndefined(value: number | undefined): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

/** Drop empty strings and an empty array (empty ≠ match-none, mirroring backend `toArray`). */
function cleanOptions(values: readonly string[] | undefined): readonly string[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  const cleaned = values.filter((v) => v !== '');
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Build the canonical `FilterSpec`: fields are inserted in a fixed order (so
 * `JSON.stringify` is deterministic for the URL), empty terms are omitted, an
 * impossible `min>max` range is dropped whole (the backend 400s it), and
 * `intentMode` survives only alongside `intent` (mirrors backend `buildPredicate`).
 * Idempotent — normalising an already-normal spec returns an equal spec.
 */
function normalizeSpec(raw: RawFilterInput): FilterSpec {
  const out: MutableSpec = {};

  if (isValidRange(raw.volumeMin, raw.volumeMax)) {
    const min = finiteOrUndefined(raw.volumeMin);
    const max = finiteOrUndefined(raw.volumeMax);
    if (min !== undefined) out.volumeMin = min;
    if (max !== undefined) out.volumeMax = max;
  }

  if (typeof raw.q === 'string' && raw.q !== '') {
    out.q = raw.q;
  }

  const intent = cleanOptions(raw.intent);
  if (intent !== undefined) {
    out.intent = intent;
    if (raw.intentMode !== undefined) out.intentMode = raw.intentMode;
  }

  const competition = cleanOptions(raw.competition);
  if (competition !== undefined) {
    out.competition = competition;
  }

  if (isValidRange(raw.competitionIndexMin, raw.competitionIndexMax)) {
    const min = finiteOrUndefined(raw.competitionIndexMin);
    const max = finiteOrUndefined(raw.competitionIndexMax);
    if (min !== undefined) out.competitionIndexMin = min;
    if (max !== undefined) out.competitionIndexMax = max;
  }

  if (isValidRange(raw.cpcMin, raw.cpcMax)) {
    const min = finiteOrUndefined(raw.cpcMin);
    const max = finiteOrUndefined(raw.cpcMax);
    if (min !== undefined) out.cpcMin = min;
    if (max !== undefined) out.cpcMax = max;
  }

  return out;
}

function isEmptySpec(spec: FilterSpec): boolean {
  return Object.keys(spec).length === 0;
}

// ── chips → FilterSpec ───────────────────────────────────────────────────────

/**
 * Fold chips into a `FilterSpec` (TC-3). Each chip contributes its own field(s),
 * so distinct filters combine as AND; an options chip's array is the OR set.
 * The result is normalised (empty / min>max dropped).
 */
export function chipsToSpec(chips: readonly Chip[]): FilterSpec {
  const raw: RawFilterInput = {};
  for (const chip of chips) {
    switch (chip.type) {
      case 'inex':
        // The 搜尋詞 include term maps to the backend `q` (case-insensitive contains).
        // `aiIntent` is a display chip (no FilterSpec field) — it contributes nothing.
        if (chip.field === 'keyword' && chip.include !== undefined) raw.q = chip.include;
        break;
      case 'range':
        if (chip.field === 'volume') {
          raw.volumeMin = chip.min;
          raw.volumeMax = chip.max;
        } else if (chip.field === 'competitionIndex') {
          raw.competitionIndexMin = chip.min;
          raw.competitionIndexMax = chip.max;
        } else {
          raw.cpcMin = chip.min;
          raw.cpcMax = chip.max;
        }
        break;
      case 'options':
        if (chip.field === 'intent') {
          raw.intent = chip.values;
          if (chip.mode !== undefined) raw.intentMode = chip.mode;
        } else if (chip.field === 'competition') {
          raw.competition = chip.values;
        }
        // `trend` is a display chip (no FilterSpec field) — it contributes nothing.
        break;
      case 'menukw':
        // 主題 dimension — routed at the view level (M3+), not part of the flat
        // /keywords FilterSpec. Deliberately contributes nothing to the base spec.
        break;
    }
  }
  return normalizeSpec(raw);
}

// ── FilterSpec → chips ───────────────────────────────────────────────────────

/**
 * Project a `FilterSpec` back to chips (one chip per present field group),
 * carrying backend-native values so `chipsToSpec(specToChips(spec))` is the
 * identity (TC-4). The codec is FilterSpec-centric: a `menukw` (topic dimension)
 * chip never appears here because the FilterSpec has no such field — which is
 * exactly why the round-trip is closed.
 */
export function specToChips(spec: FilterSpec): Chip[] {
  const chips: Chip[] = [];

  if (spec.volumeMin !== undefined || spec.volumeMax !== undefined) {
    chips.push({ type: 'range', field: 'volume', min: spec.volumeMin, max: spec.volumeMax });
  }
  if (spec.q !== undefined) {
    chips.push({ type: 'inex', field: 'keyword', include: spec.q });
  }
  if (spec.intent !== undefined) {
    chips.push({ type: 'options', field: 'intent', values: spec.intent, mode: spec.intentMode });
  }
  if (spec.competition !== undefined) {
    chips.push({ type: 'options', field: 'competition', values: spec.competition });
  }
  if (spec.competitionIndexMin !== undefined || spec.competitionIndexMax !== undefined) {
    chips.push({
      type: 'range',
      field: 'competitionIndex',
      min: spec.competitionIndexMin,
      max: spec.competitionIndexMax,
    });
  }
  if (spec.cpcMin !== undefined || spec.cpcMax !== undefined) {
    chips.push({ type: 'range', field: 'cpc', min: spec.cpcMin, max: spec.cpcMax });
  }

  return chips;
}

// ── component-facing edit helpers (still the single codec) ────────────────────

/** Replace one field's contribution in a spec, leaving every other filter intact (AND). */
export function applyChip(spec: FilterSpec, chip: Chip): FilterSpec {
  const others = specToChips(spec).filter((c) => c.field !== chip.field);
  return chipsToSpec([...others, chip]);
}

/** Remove a single field from the spec. */
export function clearField(spec: FilterSpec, field: FilterFieldKey): FilterSpec {
  return chipsToSpec(specToChips(spec).filter((c) => c.field !== field));
}

/**
 * Canonicalise a `FilterSpec` for the wire (Design §6 C4). The ONE normalisation a
 * spec passes through before it crosses a request boundary (the `/ai-insight`
 * egress, T4.3), so the filters the backend hashes for its cache key
 * (`(snapshotId, view, filters-hash)`) are byte-identical to the `/query` + the
 * shareable-URL canonical form — both funnel through this same `normalizeSpec`
 * (`serializeFiltersToUrl` is its string projection). Idempotent: canonicalising an
 * already-canonical spec returns an equal spec; empty terms / empty-array options /
 * `min>max` ranges are dropped; key order is deterministic (input-order-independent).
 */
export function canonicalFilters(spec: FilterSpec): FilterSpec {
  return normalizeSpec(spec);
}

// ── FilterSpec ↔ URL param ───────────────────────────────────────────────────

/**
 * Serialize a spec to the compact URL `filters` value. `normalizeSpec` inserts
 * keys in a fixed order, so `JSON.stringify` is deterministic (equal specs →
 * identical string, independent of input key order → stable round-trip). The
 * empty spec → `''` so no `filters` param is emitted.
 */
export function serializeFiltersToUrl(spec: FilterSpec): string {
  const normalized = normalizeSpec(spec);
  return isEmptySpec(normalized) ? '' : JSON.stringify(normalized);
}

/**
 * Per-field `.catch(undefined)` drops a present-but-wrongly-typed field; the
 * top-level `.catch({})` absorbs a non-object body. Together they make the parse
 * total — a hand-edited or stale URL never throws (Design §5 / TC-11 parity).
 */
const RawFilterSchema = z
  .object({
    volumeMin: z.number().optional().catch(undefined),
    volumeMax: z.number().optional().catch(undefined),
    q: z.string().optional().catch(undefined),
    intent: z.array(z.string()).optional().catch(undefined),
    intentMode: z.enum(['any', 'all']).optional().catch(undefined),
    competition: z.array(z.string()).optional().catch(undefined),
    competitionIndexMin: z.number().optional().catch(undefined),
    competitionIndexMax: z.number().optional().catch(undefined),
    cpcMin: z.number().optional().catch(undefined),
    cpcMax: z.number().optional().catch(undefined),
  })
  .catch({});

/**
 * Boundary JSON parse for the URL param: malformed JSON is an **expected** input
 * (shared / hand-edited URLs), not a swallowed bug — it normalises to no-filter.
 * The narrow `catch` returns `undefined` (never rethrows, never hides a real error).
 */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Parse the URL `filters` value back to a normalised `FilterSpec`. Never throws:
 * a non-string, empty, malformed, or partially-invalid param normalises to the
 * empty (no-filter) spec rather than crashing the app (Design §6 C4 / TC-11).
 */
export function deserializeFiltersFromUrl(raw: unknown): FilterSpec {
  if (typeof raw !== 'string' || raw === '') {
    return {};
  }
  const parsed = safeJsonParse(raw);
  if (parsed === undefined) {
    return {};
  }
  return normalizeSpec(RawFilterSchema.parse(parsed));
}
