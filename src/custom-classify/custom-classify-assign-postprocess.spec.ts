import { UNCLASSIFIED_LABEL } from './custom-classify-assign.schema';
import { cleanLabel, postProcessCustomAssign } from './custom-classify-assign-postprocess';

const LABELS = ['transactional', 'informational'];

describe('postProcessCustomAssign (T12.8 / FR-34 / AC-34.2 / TC-70 部分)', () => {
  it('returns exactly one row per input, in input order (results = inputs, S11)', () => {
    const inputs = ['buy shoes', 'shoe review', 'nike store'];
    const out = postProcessCustomAssign(
      inputs,
      {
        results: [
          { keyword: 'buy shoes', label: 'transactional' },
          { keyword: 'shoe review', label: 'informational' },
          { keyword: 'nike store', label: 'transactional' },
        ],
      },
      LABELS,
    );
    expect(out.map((r) => r.keyword)).toEqual(inputs);
    expect(out.map((r) => r.label)).toEqual(['transactional', 'informational', 'transactional']);
  });

  it('maps a non-confirmed label to the unclassified sentinel (never the first real label)', () => {
    const out = postProcessCustomAssign(
      ['x'],
      { results: [{ keyword: 'x', label: 'made_up_label' }] },
      LABELS,
    );
    expect(out).toEqual([{ keyword: 'x', label: UNCLASSIFIED_LABEL }]);
  });

  it('maps a keyword the LLM omitted to unclassified (gap fallback)', () => {
    const out = postProcessCustomAssign(
      ['a', 'b'],
      { results: [{ keyword: 'a', label: 'transactional' }] },
      LABELS,
    );
    expect(out).toEqual([
      { keyword: 'a', label: 'transactional' },
      { keyword: 'b', label: UNCLASSIFIED_LABEL },
    ]);
  });

  it('matches results back by normalizedText (case/whitespace-insensitive)', () => {
    const out = postProcessCustomAssign(
      ['Buy  SHOES'],
      { results: [{ keyword: 'buy shoes', label: 'transactional' }] },
      LABELS,
    );
    expect(out).toEqual([{ keyword: 'Buy  SHOES', label: 'transactional' }]); // 原字保留、對回成功
  });

  it('last-write-wins on duplicate keys (last invalid → unclassified)', () => {
    const out = postProcessCustomAssign(
      ['a'],
      {
        results: [
          { keyword: 'a', label: 'transactional' },
          { keyword: 'a', label: 'nope' },
        ],
      },
      LABELS,
    );
    expect(out).toEqual([{ keyword: 'a', label: UNCLASSIFIED_LABEL }]);
  });

  it('drops hallucinated results for keywords the user never submitted', () => {
    const out = postProcessCustomAssign(
      ['a'],
      {
        results: [
          { keyword: 'a', label: 'transactional' },
          { keyword: 'ghost', label: 'informational' },
        ],
      },
      LABELS,
    );
    expect(out).toEqual([{ keyword: 'a', label: 'transactional' }]);
  });
});

describe('cleanLabel (validation boundary)', () => {
  it('preserves a confirmed label and rejects everything else', () => {
    const allowed = new Set(LABELS);
    expect(cleanLabel('transactional', allowed)).toBe('transactional');
    expect(cleanLabel('unknown', allowed)).toBeNull();
    expect(cleanLabel(UNCLASSIFIED_LABEL, allowed)).toBeNull(); // sentinel is not a confirmed label
  });
});
