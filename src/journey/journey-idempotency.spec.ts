import { computeJourneyIdempotencyKey } from './journey-idempotency';
import type { JourneyRunParams } from './journey-run.types';

const PARAMS: JourneyRunParams = { schemaVersion: 'v1', deployment: 'gpt-4o-mini' };

describe('computeJourneyIdempotencyKey (T12.6 / FR-33 / AC-33.6)', () => {
  it('is a deterministic sha256 hex (same inputs → same key)', () => {
    const a = computeJourneyIdempotencyKey('an-1', 'chk-1', PARAMS);
    const b = computeJourneyIdempotencyKey('an-1', 'chk-1', PARAMS);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is key-order invariant over params (canonical S9)', () => {
    const a = computeJourneyIdempotencyKey('an-1', 'chk-1', {
      schemaVersion: 'v1',
      deployment: 'gpt-4o-mini',
    });
    const b = computeJourneyIdempotencyKey('an-1', 'chk-1', {
      deployment: 'gpt-4o-mini',
      schemaVersion: 'v1',
    });
    expect(a).toBe(b);
  });

  it('differs by analysisId (scope: two identical-content analyses must not collide)', () => {
    expect(computeJourneyIdempotencyKey('an-1', 'chk-1', PARAMS)).not.toBe(
      computeJourneyIdempotencyKey('an-2', 'chk-1', PARAMS),
    );
  });

  it('differs by snapshot checksum (content change → new key)', () => {
    expect(computeJourneyIdempotencyKey('an-1', 'chk-1', PARAMS)).not.toBe(
      computeJourneyIdempotencyKey('an-1', 'chk-2', PARAMS),
    );
  });

  it('differs when the schema version is bumped (batch invalidation)', () => {
    expect(computeJourneyIdempotencyKey('an-1', 'chk-1', PARAMS)).not.toBe(
      computeJourneyIdempotencyKey('an-1', 'chk-1', { ...PARAMS, schemaVersion: 'v2' }),
    );
  });

  it('differs when the deployment changes', () => {
    expect(computeJourneyIdempotencyKey('an-1', 'chk-1', PARAMS)).not.toBe(
      computeJourneyIdempotencyKey('an-1', 'chk-1', { ...PARAMS, deployment: 'gpt-4o' }),
    );
  });
});
