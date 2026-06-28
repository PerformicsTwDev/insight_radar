import {
  chunkHistorical,
  chunkSeeds,
  MAX_HISTORICAL_BATCH_SIZE,
  MAX_SEED_BATCH_SIZE,
} from './chunk';

/** 產生 n 個唯一 seed 字串。 */
const seeds = (n: number): string[] => Array.from({ length: n }, (_, i) => `seed-${i}`);

describe('chunkSeeds (TC-2)', () => {
  it('splits 21 seeds into 2 batches (default batchSize 15)', () => {
    const out = chunkSeeds(seeds(21));
    expect(out.map((b) => b.length)).toEqual([15, 6]);
  });

  it('splits 40 seeds into 2 batches at the hard cap of 20', () => {
    const out = chunkSeeds(seeds(40), 20);
    expect(out.map((b) => b.length)).toEqual([20, 20]);
  });

  it('splits 60 seeds into 3 batches at the hard cap of 20', () => {
    const out = chunkSeeds(seeds(60), 20);
    expect(out.map((b) => b.length)).toEqual([20, 20, 20]);
  });

  it('never emits a batch larger than 20, even when batchSize exceeds the cap', () => {
    const out = chunkSeeds(seeds(100), 50);
    expect(Math.max(...out.map((b) => b.length))).toBeLessThanOrEqual(MAX_SEED_BATCH_SIZE);
    expect(out.map((b) => b.length)).toEqual([20, 20, 20, 20, 20]);
  });

  it('honours a custom batchSize within range', () => {
    const out = chunkSeeds(seeds(10), 4);
    expect(out.map((b) => b.length)).toEqual([4, 4, 2]);
  });

  it('clamps batchSize below 1 up to 1', () => {
    const out = chunkSeeds(seeds(3), 0);
    expect(out.map((b) => b.length)).toEqual([1, 1, 1]);
  });

  it('returns no batches for an empty input', () => {
    expect(chunkSeeds([])).toEqual([]);
  });

  it('falls back to the default when batchSize is non-finite (no seed loss)', () => {
    // 防呆：NaN/Infinity 不得靜默吞掉所有 seed（仍須涵蓋全部輸入且每批 ≤20）。
    for (const bad of [NaN, Infinity, -Infinity]) {
      const out = chunkSeeds(seeds(25), bad);
      expect(out.flat()).toHaveLength(25);
      expect(Math.max(...out.map((b) => b.length))).toBeLessThanOrEqual(MAX_SEED_BATCH_SIZE);
    }
  });

  it('floors a fractional batchSize and never exceeds the cap', () => {
    expect(chunkSeeds(seeds(10), 20.9).map((b) => b.length)).toEqual([10]);
    expect(chunkSeeds(seeds(10), 4.7).map((b) => b.length)).toEqual([4, 4, 2]);
  });

  it('preserves order and content across batches', () => {
    const input = seeds(5);
    const out = chunkSeeds(input, 2);
    expect(out.flat()).toEqual(input);
  });

  it('exposes the hard cap as 20', () => {
    expect(MAX_SEED_BATCH_SIZE).toBe(20);
  });
});

describe('chunkHistorical (TC-34)', () => {
  it('exposes the historical hard cap as 10000', () => {
    expect(MAX_HISTORICAL_BATCH_SIZE).toBe(10000);
  });

  it('defaults to batches of 1000', () => {
    const out = chunkHistorical(seeds(2500));
    expect(out.map((b) => b.length)).toEqual([1000, 1000, 500]);
  });

  it('honours a custom batchSize and never exceeds the 10000 cap', () => {
    expect(chunkHistorical(seeds(5), 2).map((b) => b.length)).toEqual([2, 2, 1]);
    expect(Math.max(...chunkHistorical(seeds(50), 99999).map((b) => b.length))).toBeLessThanOrEqual(
      MAX_HISTORICAL_BATCH_SIZE,
    );
  });

  it('falls back to the default when batchSize is non-finite', () => {
    const out = chunkHistorical(seeds(1500), NaN);
    expect(out.flat()).toHaveLength(1500);
    expect(out[0].length).toBe(1000);
  });
});
