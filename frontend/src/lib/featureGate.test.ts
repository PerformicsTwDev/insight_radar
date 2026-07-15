import { describe, expect, it } from 'vitest';
import { featureStatusOf, type FeatureStatus } from './featureGate';

/**
 * TC-20 (core) — defensive feature-status extraction from the opaque `GET :id`
 * `features` map (T3.2, FR-9). A missing/malformed gate must resolve to
 * `not_generated`, never throw.
 */
describe('TC-20 · featureStatusOf', () => {
  it('extracts a valid status for a present feature key', () => {
    const features = { topics: { status: 'ready' }, keyword_metrics: { status: 'running' } };
    expect(featureStatusOf(features, 'topics')).toBe('ready');
    expect(featureStatusOf(features, 'keyword_metrics')).toBe('running');
  });

  it('returns not_generated for an absent key', () => {
    expect(featureStatusOf({ keyword_metrics: { status: 'ready' } }, 'topics')).toBe(
      'not_generated',
    );
  });

  it('returns not_generated for a non-object / missing features map', () => {
    expect(featureStatusOf(undefined, 'topics')).toBe('not_generated');
    expect(featureStatusOf(null, 'topics')).toBe('not_generated');
    expect(featureStatusOf('nope', 'topics')).toBe('not_generated');
    expect(featureStatusOf(42, 'topics')).toBe('not_generated');
  });

  it('returns not_generated for a malformed entry / unknown status value', () => {
    expect(featureStatusOf({ topics: { status: 'galaxy' } }, 'topics')).toBe('not_generated');
    expect(featureStatusOf({ topics: {} }, 'topics')).toBe('not_generated');
    expect(featureStatusOf({ topics: null }, 'topics')).toBe('not_generated');
  });

  it('round-trips every declared FeatureStatus', () => {
    const all: FeatureStatus[] = ['not_generated', 'running', 'ready', 'failed'];
    for (const status of all) {
      expect(featureStatusOf({ f: { status } }, 'f')).toBe(status);
    }
  });
});
