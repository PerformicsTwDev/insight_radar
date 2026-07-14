import { describe, expect, it } from 'vitest';
import {
  buildChip,
  optionLabel,
  parseNum,
  rangeLabel,
  toggleValue,
  valueLabel,
  type ChipInputs,
} from './filterLabels';
import { FILTER_FIELDS } from './filterFields';
import type { Chip } from '../../../lib/filterSpec';

/** Exhaustive unit coverage for the pure chip helpers extracted from FilterBar (T2.5). */

const inputs = (patch: Partial<ChipInputs> = {}): ChipInputs => ({
  include: '',
  exclude: '',
  minText: '',
  maxText: '',
  selected: [],
  topic: '',
  keyword: '',
  current: undefined,
  ...patch,
});

describe('buildChip', () => {
  it('inex: trims include; empty exclude → undefined', () => {
    expect(buildChip('keyword', FILTER_FIELDS.keyword, inputs({ include: ' pets ' }))).toEqual({
      type: 'inex',
      field: 'keyword',
      include: 'pets',
      exclude: undefined,
    });
  });

  it('inex: keeps a trimmed non-empty exclude', () => {
    expect(
      buildChip('keyword', FILTER_FIELDS.keyword, inputs({ include: 'a', exclude: ' b ' })),
    ).toEqual({ type: 'inex', field: 'keyword', include: 'a', exclude: 'b' });
  });

  it('range: parses min/max', () => {
    expect(
      buildChip('volume', FILTER_FIELDS.volume, inputs({ minText: '10', maxText: '20' })),
    ).toEqual({ type: 'range', field: 'volume', min: 10, max: 20 });
  });

  it('options: preserves an existing options-chip mode across edits', () => {
    const current: Chip = { type: 'options', field: 'intent', values: ['x'], mode: 'all' };
    expect(
      buildChip('intent', FILTER_FIELDS.intent, inputs({ selected: ['commercial'], current })),
    ).toEqual({ type: 'options', field: 'intent', values: ['commercial'], mode: 'all' });
  });

  it('options: mode undefined when the current chip is not an options chip', () => {
    expect(buildChip('intent', FILTER_FIELDS.intent, inputs({ selected: ['commercial'] }))).toEqual(
      { type: 'options', field: 'intent', values: ['commercial'], mode: undefined },
    );
  });

  it('menukw: trims topic; empty keyword → undefined', () => {
    expect(
      buildChip('intentTopic', FILTER_FIELDS.intentTopic, inputs({ topic: ' t ', keyword: '' })),
    ).toEqual({ type: 'menukw', field: 'intentTopic', topic: 't', keyword: undefined });
  });
});

describe('parseNum', () => {
  it('blank → undefined', () => expect(parseNum('   ')).toBeUndefined());
  it('non-finite → undefined', () => expect(parseNum('abc')).toBeUndefined());
  it('numeric → number (trimmed)', () => expect(parseNum(' 5 ')).toBe(5));
});

describe('toggleValue', () => {
  it('adds an absent value', () => expect(toggleValue(['a'], 'b')).toEqual(['a', 'b']));
  it('removes a present value', () => expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']));
});

describe('valueLabel', () => {
  it('unset → 不限', () => expect(valueLabel(undefined, FILTER_FIELDS.keyword)).toBe('不限'));

  it('range → range label', () =>
    expect(
      valueLabel({ type: 'range', field: 'volume', min: 10, max: 20 }, FILTER_FIELDS.volume),
    ).toBe('10–20'));

  it('options → joined zh option labels', () =>
    expect(
      valueLabel(
        { type: 'options', field: 'competition', values: ['HIGH', 'LOW'] },
        FILTER_FIELDS.competition,
      ),
    ).toBe('高、低'));

  it('inex → 含 <include>', () =>
    expect(
      valueLabel({ type: 'inex', field: 'keyword', include: 'pets' }, FILTER_FIELDS.keyword),
    ).toBe('含 pets'));

  it('inex with an absent include → 含 (the `?? ""` fallback)', () =>
    expect(valueLabel({ type: 'inex', field: 'keyword' }, FILTER_FIELDS.keyword)).toBe('含 '));

  it('menukw never round-trips from the spec → 不限 (defensive branch)', () =>
    expect(valueLabel({ type: 'menukw', field: 'intentTopic' }, FILTER_FIELDS.intentTopic)).toBe(
      '不限',
    ));
});

describe('rangeLabel', () => {
  it('both bounds → min–max', () => expect(rangeLabel(10, 20, false)).toBe('10–20'));
  it('min only → min+', () => expect(rangeLabel(10, undefined, false)).toBe('10+'));
  it('max only → ≤max', () => expect(rangeLabel(undefined, 20, false)).toBe('≤20'));
  it('neither bound → ≤0 (defensive; empty range is normally omitted)', () =>
    expect(rangeLabel(undefined, undefined, false)).toBe('≤0'));
  it('money prefixes NT$', () => expect(rangeLabel(1, 2, true)).toBe('NT$1–NT$2'));
});

describe('optionLabel', () => {
  it('known value → zh label', () =>
    expect(optionLabel(FILTER_FIELDS.competition, 'HIGH')).toBe('高'));
  it('unknown value → the raw value (e.g. a stale URL value)', () =>
    expect(optionLabel(FILTER_FIELDS.competition, 'zzz')).toBe('zzz'));
  it('a field with no options → the raw value', () =>
    expect(optionLabel(FILTER_FIELDS.keyword, 'x')).toBe('x'));
});
