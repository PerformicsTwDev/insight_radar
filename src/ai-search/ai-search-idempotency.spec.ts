import type { CaptureChannel } from '../captures/dto/capture-ingest.dto';
import { computeAiSearchIdempotencyKey } from './ai-search-idempotency';
import { AI_SEARCH_SCHEMA_VERSION, type AiSearchRunParams } from './ai-search-run.types';

const PARAMS: AiSearchRunParams = {
  schemaVersion: AI_SEARCH_SCHEMA_VERSION,
  analysisSchemaVersion: 'v1',
};
const CH: CaptureChannel[] = ['chatGpt', 'googleAiMode'];

/** TC-77 部分（T14.6 · FR-41/AC-41.1）：AI Search idempotency key（owner + 語意輸入 canonical）。 */
describe('TC-77: computeAiSearchIdempotencyKey', () => {
  it('is stable for the same semantic input', () => {
    const a = computeAiSearchIdempotencyKey(['a', 'b'], CH, null, PARAMS, null);
    const b = computeAiSearchIdempotencyKey(['a', 'b'], CH, null, PARAMS, null);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is keyword order- and case/whitespace-insensitive (shared normalizeText + sort)', () => {
    const a = computeAiSearchIdempotencyKey(['Running Shoes', 'Trail'], CH, null, PARAMS, null);
    const b = computeAiSearchIdempotencyKey([' trail ', 'running shoes'], CH, null, PARAMS, null);
    expect(a).toBe(b);
  });

  it('is channel order-insensitive (sort)', () => {
    const a = computeAiSearchIdempotencyKey(['a'], ['chatGpt', 'googleSearch'], null, PARAMS, null);
    const b = computeAiSearchIdempotencyKey(['a'], ['googleSearch', 'chatGpt'], null, PARAMS, null);
    expect(a).toBe(b);
  });

  it('differs when the channel set differs', () => {
    const a = computeAiSearchIdempotencyKey(['a'], ['chatGpt'], null, PARAMS, null);
    const b = computeAiSearchIdempotencyKey(['a'], ['chatGpt', 'googleSearch'], null, PARAMS, null);
    expect(a).not.toBe(b);
  });

  it('scopes by owner: different session owners get different keys; machine null is shared', () => {
    const ownerA = computeAiSearchIdempotencyKey(['a'], CH, null, PARAMS, 'owner-A');
    const ownerB = computeAiSearchIdempotencyKey(['a'], CH, null, PARAMS, 'owner-B');
    const machine1 = computeAiSearchIdempotencyKey(['a'], CH, null, PARAMS, null);
    const machine2 = computeAiSearchIdempotencyKey(['a'], CH, null, PARAMS, null);
    expect(ownerA).not.toBe(ownerB);
    expect(ownerA).not.toBe(machine1);
    expect(machine1).toBe(machine2);
  });

  it('differs when brandProfileId is present vs absent', () => {
    const withBrand = computeAiSearchIdempotencyKey(['a'], CH, 'brand-1', PARAMS, null);
    const without = computeAiSearchIdempotencyKey(['a'], CH, null, PARAMS, null);
    expect(withBrand).not.toBe(without);
  });

  it('differs when the fetch-layer schemaVersion is bumped', () => {
    const v1 = computeAiSearchIdempotencyKey(
      ['a'],
      CH,
      null,
      { schemaVersion: 'v1', analysisSchemaVersion: 'v1' },
      null,
    );
    const v2 = computeAiSearchIdempotencyKey(
      ['a'],
      CH,
      null,
      { schemaVersion: 'v2', analysisSchemaVersion: 'v1' },
      null,
    );
    expect(v1).not.toBe(v2);
  });

  it('differs when the analysis-layer schemaVersion is bumped (M15-R5, #687)', () => {
    // AI_VISIBILITY_SCHEMA_VERSION tags the analysis rows; bumping it must force a new run so the
    // in-job analysis re-runs and re-tags — omitting it (the old bug) hit the completed run forever.
    const v1 = computeAiSearchIdempotencyKey(
      ['a'],
      CH,
      null,
      { schemaVersion: 'x', analysisSchemaVersion: 'v1' },
      null,
    );
    const v2 = computeAiSearchIdempotencyKey(
      ['a'],
      CH,
      null,
      { schemaVersion: 'x', analysisSchemaVersion: 'v2' },
      null,
    );
    expect(v1).not.toBe(v2);
  });
});
