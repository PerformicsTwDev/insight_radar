import {
  applyChip,
  chipsToSpec,
  clearField,
  deserializeFiltersFromUrl,
  isValidRange,
  serializeFiltersToUrl,
  specToChips,
  type Chip,
  type FilterSpec,
} from './filterSpec';

/**
 * TC-3 / TC-4 (FR-6, Design §6 C4): the ONE bidirectional chips ↔ FilterSpec ↔
 * URL codec. `FilterSpec` is backend-exact (src/keywords/filter-spec.ts). The
 * three-way mapping lives only here so the UI, the `/query`+`/keywords` filters,
 * and the shareable URL can never drift apart. Semantics: multiple filters = AND,
 * options within a filter = OR, min>max blocked, empty terms omitted, and a
 * FilterSpec → chips → FilterSpec round-trip is the identity.
 */

// Canonical enum values (backend-native — chips carry enum values, not zh labels).
const INFO = 'informational';
const COMM = 'commercial';
const TRANS = 'transactional';
const HIGH = 'HIGH';
const MED = 'MEDIUM';

describe('TC-3 · chipsToSpec (chips → FilterSpec)', () => {
  it('combines multiple filters as AND (each chip contributes its own field)', () => {
    const chips: Chip[] = [
      { type: 'range', field: 'volume', min: 100 },
      { type: 'options', field: 'intent', values: [INFO, COMM] },
      { type: 'inex', field: 'keyword', include: 'shoe' },
      { type: 'options', field: 'competition', values: [HIGH] },
    ];
    expect(chipsToSpec(chips)).toEqual({
      volumeMin: 100,
      q: 'shoe',
      intent: [INFO, COMM],
      competition: [HIGH],
    });
  });

  it('keeps an options chip as an OR set (the array carries every selected option)', () => {
    expect(
      chipsToSpec([{ type: 'options', field: 'intent', values: [INFO, COMM, TRANS] }]),
    ).toEqual({ intent: [INFO, COMM, TRANS] });
  });

  it('maps an inex include term to the backend q (case-insensitive contains)', () => {
    expect(chipsToSpec([{ type: 'inex', field: 'keyword', include: '吸塵器' }])).toEqual({
      q: '吸塵器',
    });
  });

  it('omits an empty include term (empty string is not a filter)', () => {
    expect(chipsToSpec([{ type: 'inex', field: 'keyword', include: '' }])).toEqual({});
  });

  it('omits an empty / all-blank options selection (empty ≠ match-none)', () => {
    expect(chipsToSpec([{ type: 'options', field: 'intent', values: [] }])).toEqual({});
    expect(chipsToSpec([{ type: 'options', field: 'competition', values: ['', ''] }])).toEqual({});
  });

  it('maps every range field to its two backend bounds', () => {
    expect(chipsToSpec([{ type: 'range', field: 'volume', min: 100, max: 500 }])).toEqual({
      volumeMin: 100,
      volumeMax: 500,
    });
    expect(chipsToSpec([{ type: 'range', field: 'competitionIndex', min: 10, max: 50 }])).toEqual({
      competitionIndexMin: 10,
      competitionIndexMax: 50,
    });
    expect(chipsToSpec([{ type: 'range', field: 'cpc', min: 2, max: 8 }])).toEqual({
      cpcMin: 2,
      cpcMax: 8,
    });
  });

  it('honours a single open bound and a 0 bound (0 is an active bound, not unset)', () => {
    expect(chipsToSpec([{ type: 'range', field: 'volume', min: 50 }])).toEqual({ volumeMin: 50 });
    expect(chipsToSpec([{ type: 'range', field: 'cpc', max: 5 }])).toEqual({ cpcMax: 5 });
    expect(chipsToSpec([{ type: 'range', field: 'volume', min: 0 }])).toEqual({ volumeMin: 0 });
  });

  it('drops an impossible range (min>max) entirely — never sends a min>max the backend 400s', () => {
    expect(chipsToSpec([{ type: 'range', field: 'volume', min: 500, max: 100 }])).toEqual({});
    expect(chipsToSpec([{ type: 'range', field: 'cpc', min: 9, max: 1 }])).toEqual({});
  });

  it('carries intentMode only when present (mirrors backend default any)', () => {
    expect(
      chipsToSpec([{ type: 'options', field: 'intent', values: [INFO], mode: 'all' }]),
    ).toEqual({ intent: [INFO], intentMode: 'all' });
    expect(chipsToSpec([{ type: 'options', field: 'intent', values: [INFO] }])).toEqual({
      intent: [INFO],
    });
  });

  it('ignores a menukw chip (topic dimension is not part of the flat /keywords FilterSpec)', () => {
    // menukw = 主題+關鍵字 is a view-router grouping concern (M3+), not a base filter.
    expect(
      chipsToSpec([{ type: 'menukw', field: 'intentTopic', topic: '清潔', keyword: '寵物' }]),
    ).toEqual({});
    expect(
      chipsToSpec([
        { type: 'inex', field: 'keyword', include: 'shoe' },
        { type: 'menukw', field: 'intentTopic', topic: '清潔' },
      ]),
    ).toEqual({ q: 'shoe' });
  });
});

describe('TC-4 · round-trip identity (FilterSpec → chips → FilterSpec)', () => {
  const specs: ReadonlyArray<readonly [string, FilterSpec]> = [
    ['empty', {}],
    ['q only', { q: 'shoe' }],
    ['volume range', { volumeMin: 100, volumeMax: 500 }],
    ['volume open lower', { volumeMin: 100 }],
    ['volume 0 bound', { volumeMin: 0 }],
    ['intent OR set', { intent: [INFO, COMM] }],
    ['intent all mode', { intent: [INFO, COMM], intentMode: 'all' }],
    ['competition', { competition: [HIGH, MED] }],
    ['competitionIndex range', { competitionIndexMin: 10, competitionIndexMax: 50 }],
    ['cpc range', { cpcMin: 2, cpcMax: 8 }],
    [
      'fully populated',
      {
        volumeMin: 100,
        volumeMax: 500,
        q: 'shoe',
        intent: [INFO, COMM],
        intentMode: 'all',
        competition: [HIGH],
        competitionIndexMin: 10,
        competitionIndexMax: 50,
        cpcMin: 2,
        cpcMax: 8,
      },
    ],
  ];

  it.each(specs)('chipsToSpec(specToChips(%s)) deep-equals the spec', (_name, spec) => {
    expect(chipsToSpec(specToChips(spec))).toEqual(spec);
  });

  it.each(specs)(
    'deserializeFiltersFromUrl(serializeFiltersToUrl(%s)) deep-equals the spec',
    (_name, spec) => {
      expect(deserializeFiltersFromUrl(serializeFiltersToUrl(spec))).toEqual(spec);
    },
  );

  it('is three-way consistent: chips → spec → url → spec → chips', () => {
    const chips: Chip[] = [
      { type: 'options', field: 'intent', values: [INFO, COMM] },
      { type: 'range', field: 'volume', min: 100 },
      { type: 'inex', field: 'keyword', include: '吸塵器' },
    ];
    const spec = chipsToSpec(chips);
    const url = serializeFiltersToUrl(spec);
    const back = deserializeFiltersFromUrl(url);
    expect(back).toEqual(spec);
    expect(chipsToSpec(specToChips(back))).toEqual(spec);
  });
});

describe('TC-4 · URL codec (compact, stable, never throws)', () => {
  it('serializes the empty spec to an empty string (no filters param in the URL)', () => {
    expect(serializeFiltersToUrl({})).toBe('');
  });

  it('deserializes an empty / whitespace-absent param to the empty spec', () => {
    expect(deserializeFiltersFromUrl('')).toEqual({});
    expect(deserializeFiltersFromUrl(undefined)).toEqual({});
  });

  it('produces a stable, order-independent string for equal specs', () => {
    const a = serializeFiltersToUrl({ q: 'shoe', volumeMin: 100, intent: [INFO] });
    const b = serializeFiltersToUrl({ intent: [INFO], volumeMin: 100, q: 'shoe' });
    expect(a).toBe(b);
    expect(a).not.toBe('');
  });

  it('never throws and normalises malformed input to the empty spec', () => {
    for (const bad of ['not json', '{', '[1,2,3]', '42', 'null', '{"volumeMin":"nope"}']) {
      expect(() => deserializeFiltersFromUrl(bad)).not.toThrow();
      expect(deserializeFiltersFromUrl(bad)).toEqual({});
    }
    // non-string inputs also normalise without throwing (defensive codec boundary).
    for (const bad of [null, 42, [], {}, true]) {
      expect(() => deserializeFiltersFromUrl(bad)).not.toThrow();
      expect(deserializeFiltersFromUrl(bad)).toEqual({});
    }
  });

  it('drops unknown / wrongly-typed keys but keeps the valid ones', () => {
    const raw = JSON.stringify({ volumeMin: 100, bogus: 'x', intent: 'nope', q: 'shoe' });
    expect(deserializeFiltersFromUrl(raw)).toEqual({ volumeMin: 100, q: 'shoe' });
  });

  it('normalises a min>max range and an intentMode-without-intent away on deserialize', () => {
    expect(deserializeFiltersFromUrl(JSON.stringify({ volumeMin: 500, volumeMax: 100 }))).toEqual(
      {},
    );
    expect(deserializeFiltersFromUrl(JSON.stringify({ intentMode: 'all' }))).toEqual({});
  });
});

describe('applyChip / clearField / isValidRange (component-facing helpers)', () => {
  it('applyChip replaces only its own field, leaving the other filters intact (AND)', () => {
    const base: FilterSpec = { q: 'shoe', volumeMin: 100 };
    const next = applyChip(base, { type: 'options', field: 'intent', values: [INFO] });
    expect(next).toEqual({ q: 'shoe', volumeMin: 100, intent: [INFO] });
  });

  it('applyChip with a cleared field removes it', () => {
    const base: FilterSpec = { q: 'shoe', volumeMin: 100 };
    expect(applyChip(base, { type: 'inex', field: 'keyword', include: '' })).toEqual({
      volumeMin: 100,
    });
  });

  it('clearField removes just that field', () => {
    const base: FilterSpec = { q: 'shoe', volumeMin: 100, intent: [INFO] };
    expect(clearField(base, 'volume')).toEqual({ q: 'shoe', intent: [INFO] });
    expect(clearField(base, 'keyword')).toEqual({ volumeMin: 100, intent: [INFO] });
  });

  it('isValidRange blocks only min>max (open / equal / unset bounds are valid)', () => {
    expect(isValidRange(100, 500)).toBe(true);
    expect(isValidRange(100, 100)).toBe(true);
    expect(isValidRange(100, undefined)).toBe(true);
    expect(isValidRange(undefined, 500)).toBe(true);
    expect(isValidRange(undefined, undefined)).toBe(true);
    expect(isValidRange(500, 100)).toBe(false);
  });
});
