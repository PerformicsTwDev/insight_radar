import {
  computeCustomClassifyIdempotencyKey,
  computeLabelsHash,
} from './custom-classify-idempotency';
import type { CustomClassifyRunParams } from './custom-classify-run.types';

const CID = '11111111-1111-1111-1111-111111111111';
const PARAMS: CustomClassifyRunParams = {
  schemaVersion: 'v1',
  deployment: 'gpt-4o-mini',
  labelsHash: 'lh-1',
};

describe('computeLabelsHash (T12.8 / FR-34 / AC-34.2)', () => {
  const A = { label: 'transactional', description: 'buy' };
  const B = { label: 'informational', description: 'research' };

  it('is reorder-invariant (same taxonomy, different order → same hash)', () => {
    expect(computeLabelsHash([A, B])).toBe(computeLabelsHash([B, A]));
  });

  it('changes when a label is added/removed', () => {
    expect(computeLabelsHash([A])).not.toBe(computeLabelsHash([A, B]));
  });

  it('changes when a description changes (affects classification guidance → re-run)', () => {
    expect(computeLabelsHash([A])).not.toBe(
      computeLabelsHash([{ label: 'transactional', description: 'ready to purchase' }]),
    );
  });
});

describe('computeCustomClassifyIdempotencyKey (T12.8 / FR-34 / AC-34.2)', () => {
  it('is deterministic for the same (cid, checksum, params)', () => {
    expect(computeCustomClassifyIdempotencyKey(CID, 'chk', PARAMS)).toBe(
      computeCustomClassifyIdempotencyKey(CID, 'chk', PARAMS),
    );
  });

  it('differs when the confirmed labels change (labelsHash) → allows a new run', () => {
    expect(computeCustomClassifyIdempotencyKey(CID, 'chk', PARAMS)).not.toBe(
      computeCustomClassifyIdempotencyKey(CID, 'chk', { ...PARAMS, labelsHash: 'lh-2' }),
    );
  });

  it('differs by classificationId, snapshot checksum, schemaVersion, and deployment', () => {
    const base = computeCustomClassifyIdempotencyKey(CID, 'chk', PARAMS);
    expect(
      computeCustomClassifyIdempotencyKey('22222222-2222-2222-2222-222222222222', 'chk', PARAMS),
    ).not.toBe(base);
    expect(computeCustomClassifyIdempotencyKey(CID, 'other', PARAMS)).not.toBe(base);
    expect(
      computeCustomClassifyIdempotencyKey(CID, 'chk', { ...PARAMS, schemaVersion: 'v2' }),
    ).not.toBe(base);
    expect(
      computeCustomClassifyIdempotencyKey(CID, 'chk', { ...PARAMS, deployment: 'other' }),
    ).not.toBe(base);
  });
});
