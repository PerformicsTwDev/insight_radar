import { mergeCacheFirst, partitionCacheMisses } from './cache-first';

/**
 * Cache-first 純核心（T8.2c / M8-R9 · TC-50 · FR-16/NFR-13）。從 EmbeddingService 抽出的兩段
 * correctness-critical 邏輯：命中/未命中切分 + 依原索引回填對齊。索引一旦 off-by-one，embedding↔keyword
 * 全表錯位（每個關鍵字拿到別人的向量）——故獨立純函式測試並掛 core-90%。
 */
describe('cache-first pure core (T8.2c / M8-R9 · TC-50)', () => {
  describe('partitionCacheMisses', () => {
    it('collects only cache-miss indexes and their texts, preserving original order', () => {
      const cached = [[1], undefined, [3], undefined];
      expect(partitionCacheMisses(cached, ['a', 'b', 'c', 'd'])).toEqual({
        missIndexes: [1, 3],
        missTexts: ['b', 'd'],
      });
    });

    it('returns empty when every entry is a cache hit (no Gemini call needed)', () => {
      expect(partitionCacheMisses([[1], [2]], ['a', 'b'])).toEqual({
        missIndexes: [],
        missTexts: [],
      });
    });

    it('returns all when every entry is a cache miss (cold cache)', () => {
      expect(partitionCacheMisses([undefined, undefined], ['a', 'b'])).toEqual({
        missIndexes: [0, 1],
        missTexts: ['a', 'b'],
      });
    });
  });

  describe('mergeCacheFirst', () => {
    it('fills hits from cache and misses from provider vectors in miss order (index alignment)', () => {
      const cached = [[1], undefined, [3], undefined];
      const missVectors = [[2], [4]];
      expect(mergeCacheFirst(cached, missVectors)).toEqual([[1], [2], [3], [4]]);
    });

    it('returns cached values unchanged when there are no misses', () => {
      expect(mergeCacheFirst([[1], [2]], [])).toEqual([[1], [2]]);
    });

    it('round-trips with partitionCacheMisses so vectors realign to their original keywords', () => {
      const cached = [undefined, [9], undefined];
      const { missIndexes, missTexts } = partitionCacheMisses(cached, ['x', 'y', 'z']);
      expect(missTexts).toEqual(['x', 'z']);
      // provider returns one vector per miss, in missIndexes order → must land back on indexes 0 and 2.
      const missVectors = missIndexes.map((i) => [i * 10]);
      expect(mergeCacheFirst(cached, missVectors)).toEqual([[0], [9], [20]]);
    });
  });
});
