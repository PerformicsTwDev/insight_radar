import { checkValidity, mapFieldErrors, parseSeeds } from './createAnalysisForm';

// TC-13 (FR-2): the pure create-analysis form helpers — seeds parsing, the
// client-side validity/CTA gate, and ErrorResponse.fields → per-field mapping.
// Component behaviour is covered in features/home/HomeRoute.test.tsx.
describe('TC-13 · createAnalysisForm helpers (seeds parse / validity / field errors)', () => {
  describe('parseSeeds', () => {
    it('splits on newlines and commas, trims, and drops empties', () => {
      expect(parseSeeds('running shoes\ntrail shoes')).toEqual(['running shoes', 'trail shoes']);
      expect(parseSeeds('a, b ,c')).toEqual(['a', 'b', 'c']);
      expect(parseSeeds('  a \n\n , b ,, \n c  ')).toEqual(['a', 'b', 'c']);
    });

    it('returns [] for blank / whitespace-and-separator-only input', () => {
      expect(parseSeeds('')).toEqual([]);
      expect(parseSeeds('   \n , , \n ')).toEqual([]);
    });
  });

  describe('checkValidity', () => {
    it('is submittable only when seeds (≥1 parsed) + geo + language are all non-empty', () => {
      const ok = checkValidity({ seedsRaw: 'shoes', geo: 'TW', language: 'zh-TW' });
      expect(ok.fields).toEqual({ seeds: true, geo: true, language: true });
      expect(ok.isSubmittable).toBe(true);
    });

    it('flags empty seeds as invalid → not submittable', () => {
      const r = checkValidity({ seedsRaw: '   \n , ', geo: 'TW', language: 'zh-TW' });
      expect(r.fields.seeds).toBe(false);
      expect(r.isSubmittable).toBe(false);
    });

    it('flags empty geo as invalid → not submittable', () => {
      const r = checkValidity({ seedsRaw: 'shoes', geo: '   ', language: 'zh-TW' });
      expect(r.fields.geo).toBe(false);
      expect(r.isSubmittable).toBe(false);
    });

    it('flags empty language as invalid → not submittable', () => {
      const r = checkValidity({ seedsRaw: 'shoes', geo: 'TW', language: '' });
      expect(r.fields.language).toBe(false);
      expect(r.isSubmittable).toBe(false);
    });
  });

  describe('mapFieldErrors', () => {
    it('maps an ErrorResponse.fields object to a per-field error record', () => {
      expect(mapFieldErrors({ seeds: ['at least one seed'], geo: ['geo is required'] })).toEqual({
        seeds: ['at least one seed'],
        geo: ['geo is required'],
      });
    });

    it('returns {} for undefined and drops empty message arrays', () => {
      expect(mapFieldErrors(undefined)).toEqual({});
      expect(mapFieldErrors({ seeds: [] })).toEqual({});
      expect(mapFieldErrors({ seeds: ['x'], geo: [] })).toEqual({ seeds: ['x'] });
    });
  });
});
