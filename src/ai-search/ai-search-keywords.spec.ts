import { canonicalizeAiSearchKeywords } from './ai-search-keywords';

/** TC-77 部分 (T14.6 · FR-41; M14-R6/#582): keyword canonical 單點 — 共用 normalizeText + 去重 + 排序。 */
describe('TC-77: canonicalizeAiSearchKeywords', () => {
  it('normalizes (shared normalizeText) then dedupes keywords that collapse to the same value', () => {
    // The M14-R6 defect: these three collapse to one run via idempotency but were fetched 3× by the worker.
    expect(canonicalizeAiSearchKeywords(['Nike', 'NIKE ', 'nike'])).toEqual(['nike']);
  });

  it('sorts into a stable canonical order (order-insensitive input)', () => {
    expect(canonicalizeAiSearchKeywords(['Trail', ' running shoes '])).toEqual([
      'running shoes',
      'trail',
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(canonicalizeAiSearchKeywords([])).toEqual([]);
  });
});
