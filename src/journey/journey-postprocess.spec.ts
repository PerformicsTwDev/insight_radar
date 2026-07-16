import { cleanStage, postProcessJourney } from './journey-postprocess';

describe('cleanStage (T12.5 / TC-69 部分：驗證邊界)', () => {
  it('returns the stage when it is one of the seven valid stages', () => {
    expect(cleanStage('spec_comparison')).toBe('spec_comparison');
    expect(cleanStage('repurchase_retention')).toBe('repurchase_retention');
  });

  it('returns null for an unknown / hallucinated stage', () => {
    expect(cleanStage('awareness')).toBeNull();
    expect(cleanStage('')).toBeNull();
    expect(cleanStage('PAIN_AWARENESS')).toBeNull(); // case-sensitive enum
  });
});

describe('postProcessJourney (T12.5 / FR-33 / AC-33.2 / TC-69 部分)', () => {
  it('emits exactly one row per input, in input order (single-label)', () => {
    const out = postProcessJourney(['espresso machine', 'buy nespresso pods'], {
      results: [
        { keyword: 'buy nespresso pods', stage: 'final_decision' },
        { keyword: 'espresso machine', stage: 'need_definition' },
      ],
    });
    expect(out).toEqual([
      { keyword: 'espresso machine', stage: 'need_definition' },
      { keyword: 'buy nespresso pods', stage: 'final_decision' },
    ]);
  });

  it('maps by normalizedText (case / whitespace insensitive), preserving the user original text', () => {
    const out = postProcessJourney(['  Espresso   Machine ', 'DYSON v15'], {
      results: [
        { keyword: 'espresso machine', stage: 'solution_exploration' },
        { keyword: 'dyson v15', stage: 'spec_comparison' },
      ],
    });
    expect(out).toEqual([
      { keyword: '  Espresso   Machine ', stage: 'solution_exploration' },
      { keyword: 'DYSON v15', stage: 'spec_comparison' },
    ]);
  });

  it('falls back to need_definition when the input is missing from the LLM results', () => {
    const out = postProcessJourney(['a', 'b'], {
      results: [{ keyword: 'a', stage: 'final_decision' }],
    });
    expect(out).toEqual([
      { keyword: 'a', stage: 'final_decision' },
      { keyword: 'b', stage: 'need_definition' },
    ]);
  });

  it('falls back to need_definition for an invalid / hallucinated stage', () => {
    const out = postProcessJourney(['a'], {
      results: [{ keyword: 'a', stage: 'totally_made_up' }],
    });
    expect(out).toEqual([{ keyword: 'a', stage: 'need_definition' }]);
  });

  it('uses the LAST result for a duplicated key (last wins; last-invalid → fallback)', () => {
    const dup = postProcessJourney(['a'], {
      results: [
        { keyword: 'a', stage: 'final_decision' },
        { keyword: 'a', stage: 'pain_awareness' },
      ],
    });
    expect(dup).toEqual([{ keyword: 'a', stage: 'pain_awareness' }]);

    const lastInvalid = postProcessJourney(['a'], {
      results: [
        { keyword: 'a', stage: 'final_decision' },
        { keyword: 'a', stage: 'nonsense' },
      ],
    });
    expect(lastInvalid).toEqual([{ keyword: 'a', stage: 'need_definition' }]);
  });

  it('does NOT produce rows for keywords the user never input (drop hallucinations)', () => {
    const out = postProcessJourney(['a'], {
      results: [
        { keyword: 'a', stage: 'need_definition' },
        { keyword: 'ghost keyword', stage: 'final_decision' },
      ],
    });
    expect(out).toEqual([{ keyword: 'a', stage: 'need_definition' }]);
  });

  it('returns an empty array for empty input', () => {
    expect(postProcessJourney([], { results: [] })).toEqual([]);
  });
});
