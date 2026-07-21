import {
  EM_DASH,
  formatCompetition,
  formatCpc,
  formatCpcRange,
  formatVolume,
  resolveIntent,
  shouldVirtualize,
} from './keywordsTable';

/**
 * TC-15 (pure parts). All cell-formatting branching lives here so it can be
 * exhaustively unit-tested (core ≥90 / 100% branch) and the component stays thin.
 * The governing rule is C12: a missing value renders `—`, **never** 0.
 */
describe('TC-15 · keywordsTable formatters (null → — 不補 0, C12)', () => {
  describe('formatVolume', () => {
    it('renders — for a null volume (missing ≠ 0, C12)', () => {
      expect(formatVolume(null)).toBe(EM_DASH);
    });

    it('renders a real 0 as "0" (0 is a value, not missing)', () => {
      expect(formatVolume(0)).toBe('0');
    });

    it('groups thousands for a real value', () => {
      expect(formatVolume(12000)).toBe('12,000');
    });
  });

  describe('formatCpc', () => {
    it('renders — for a null bound', () => {
      expect(formatCpc(null)).toBe(EM_DASH);
    });

    it('formats a value as NT$ with two decimals', () => {
      expect(formatCpc(1.2)).toBe('NT$1.20');
    });

    it('renders a genuine 0 CPC as a value, not — (0 ≠ missing, C12)', () => {
      expect(formatCpc(0)).toBe('NT$0.00');
    });
  });

  describe('formatCpcRange', () => {
    it('renders a single — when both bounds are null (AC-4.1)', () => {
      expect(formatCpcRange(null, null)).toBe(EM_DASH);
    });

    it('renders low–high when both bounds are present', () => {
      expect(formatCpcRange(1.2, 3.4)).toBe('NT$1.20–NT$3.40');
    });

    it('renders — for a null low bound within the range (never 0)', () => {
      expect(formatCpcRange(null, 3.4)).toBe(`${EM_DASH}–NT$3.40`);
    });

    it('renders — for a null high bound within the range (never 0)', () => {
      expect(formatCpcRange(1.2, null)).toBe(`NT$1.20–${EM_DASH}`);
    });
  });

  describe('formatCompetition', () => {
    it('maps LOW / MEDIUM / HIGH to their zh labels', () => {
      expect(formatCompetition('LOW', null)).toBe('低');
      expect(formatCompetition('MEDIUM', null)).toBe('中');
      expect(formatCompetition('HIGH', null)).toBe('高');
    });

    it('appends the competition index when present', () => {
      expect(formatCompetition('HIGH', 87)).toBe('高 · 87');
    });

    it('falls back to the raw value for an unknown competition', () => {
      expect(formatCompetition('UNSPECIFIED', null)).toBe('UNSPECIFIED');
    });

    it('renders — for an empty competition string', () => {
      expect(formatCompetition('', null)).toBe(EM_DASH);
    });
  });

  describe('resolveIntent', () => {
    it('resolves a known intent to its zh label + token color (C2 SSOT)', () => {
      expect(resolveIntent('commercial')).toEqual({ zh: '商業型', color: '#52b788' });
    });

    it('resolves all four intent enums to their C2 zh label + token color', () => {
      expect(resolveIntent('informational')).toEqual({ zh: '資訊型', color: '#5BC0EB' });
      expect(resolveIntent('commercial')).toEqual({ zh: '商業型', color: '#52b788' });
      expect(resolveIntent('transactional')).toEqual({ zh: '交易型', color: '#FFD166' });
      expect(resolveIntent('navigational')).toEqual({ zh: '導航型', color: '#B088EE' });
    });

    it('falls back to the raw label with no color for an unknown intent', () => {
      expect(resolveIntent('mystery')).toEqual({ zh: 'mystery', color: null });
    });

    // #652 (defensive): the label indexes a plain object, whose prototype chain
    // exposes Object.prototype members. A reserved-name label must NOT resolve to
    // an inherited member (which is truthy → would render {zh:undefined}='undefined')
    // — it falls back to the raw label like any other unknown intent.
    it.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf'])(
      'falls back to the raw label for the reserved name "%s" (no prototype leak)',
      (label) => {
        expect(resolveIntent(label)).toEqual({ zh: label, color: null });
      },
    );
  });

  describe('shouldVirtualize', () => {
    it('is true only when the row count strictly exceeds the threshold', () => {
      expect(shouldVirtualize(101, 100)).toBe(true);
      expect(shouldVirtualize(100, 100)).toBe(false);
      expect(shouldVirtualize(3, 100)).toBe(false);
    });
  });
});
