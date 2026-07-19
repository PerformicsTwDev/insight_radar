import { normalizeCount } from './normalize-count';

describe('normalizeCount (AC-37.3 / FR-46 互動計數正規化)', () => {
  it('緊湊英文記法 → number（8K→8000、1.2M→1200000、2B→2000000000）', () => {
    expect(normalizeCount('8K')).toBe(8000);
    expect(normalizeCount('8k')).toBe(8000);
    expect(normalizeCount('1.2M')).toBe(1_200_000);
    expect(normalizeCount('1.2m')).toBe(1_200_000);
    expect(normalizeCount('2B')).toBe(2_000_000_000);
  });

  it('緊湊中文記法 → number（8千→8000、3.4萬→34000、繁簡萬/万、1.2億→120000000）', () => {
    expect(normalizeCount('8千')).toBe(8000);
    expect(normalizeCount('3.4萬')).toBe(34_000);
    expect(normalizeCount('3.4万')).toBe(34_000);
    expect(normalizeCount('1.2億')).toBe(120_000_000);
    expect(normalizeCount('1.2亿')).toBe(120_000_000);
  });

  it('純數字 / 數字字串 / 千分位逗號 直接取值', () => {
    expect(normalizeCount(8000)).toBe(8000);
    expect(normalizeCount('1234')).toBe(1234);
    expect(normalizeCount('1,234')).toBe(1234);
    expect(normalizeCount('12,345,678')).toBe(12_345_678);
  });

  it('小數乘數收斂為整數、無浮點殘渣（1.1K→1100、12.5K→12500）', () => {
    expect(normalizeCount('1.1K')).toBe(1100);
    expect(normalizeCount('12.5K')).toBe(12_500);
    expect(normalizeCount('1.234K')).toBe(1234);
  });

  it('0 為真實值（與缺值 null 區分）', () => {
    expect(normalizeCount(0)).toBe(0);
    expect(normalizeCount('0')).toBe(0);
  });

  it('缺值（null/undefined/空白）→ null（S14：缺值≠0，不補 0）', () => {
    expect(normalizeCount(null)).toBeNull();
    expect(normalizeCount(undefined)).toBeNull();
    expect(normalizeCount('')).toBeNull();
    expect(normalizeCount('   ')).toBeNull();
  });

  it('不可解析 → null（不外漏 NaN、不補 0）', () => {
    expect(normalizeCount('abc')).toBeNull();
    expect(normalizeCount('8XX')).toBeNull();
    expect(normalizeCount('K')).toBeNull();
    expect(normalizeCount(Number.NaN)).toBeNull();
    expect(normalizeCount(Number.POSITIVE_INFINITY)).toBeNull();
    // 超長數字字串溢位為 Infinity → null（不外漏 Infinity、不補 0）。
    expect(normalizeCount('1'.repeat(400))).toBeNull();
    expect(normalizeCount({})).toBeNull();
    expect(normalizeCount([])).toBeNull();
    expect(normalizeCount(true)).toBeNull();
  });
});
