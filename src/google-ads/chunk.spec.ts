import { chunkSeeds, MAX_SEED_BATCH_SIZE } from './chunk';

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

  it('preserves order and content across batches', () => {
    const input = seeds(5);
    const out = chunkSeeds(input, 2);
    expect(out.flat()).toEqual(input);
  });

  it('exposes the hard cap as 20', () => {
    expect(MAX_SEED_BATCH_SIZE).toBe(20);
  });
});
