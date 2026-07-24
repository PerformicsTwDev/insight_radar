import type { TopicsResponse } from '../../api/topics';
import type { FeatureStatus } from '../../lib/featureGate';
import type { DimensionCellState, DimensionHeaderPhase } from './DimensionColumn';

/**
 * Pure derivation for the on-demand dimension columns (M7-R2b/c, FR-18). Turns a dimension's
 * gate status + client-joined value into the presentational {@link DimensionColumn} props. Kept
 * out of the component so the mapping is unit-tested in isolation (the join key is `normalizedText`,
 * the C7 dedup/cache key — D2). Gate-decoupled per C13: these derive *display* only; a column's
 * generate handler runs the dimension job without unlocking the left view.
 */

/**
 * normalizedText → topicName from a `GET :id/topics` result (D2 client-join). Noise clusters and
 * null-topic keywords are omitted, so an unclassified keyword has no entry → its cell renders `—`
 * (never a fabricated pill, C12). `undefined` topics (not yet fetched) → an empty map.
 */
export function topicLabelByKey(topics: TopicsResponse | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!topics) return map;
  for (const kw of topics.keywords) {
    if (!kw.isNoise && kw.topicName) {
      map.set(kw.normalizedText, kw.topicName);
    }
  }
  return map;
}

/**
 * Gate status → column header phase: `running` → generating (progress marker), `ready` → ready
 * (plain label), and `not_generated` / `failed` → generatable (the ✦ generate-all / retry trigger).
 */
export function dimensionHeaderPhase(status: FeatureStatus): DimensionHeaderPhase {
  if (status === 'running') return 'generating';
  if (status === 'ready') return 'ready';
  return 'generatable';
}

/**
 * Gate status + this keyword's looked-up label → per-cell state: `running` → generating shimmer;
 * `ready` → a value pill when the keyword is classified, else `empty` (—); otherwise masked
 * (pre-generation). `label === undefined` at `ready` means the keyword carried no topic (noise).
 */
export function dimensionCellState(
  status: FeatureStatus,
  label: string | undefined,
): DimensionCellState {
  if (status === 'running') return { kind: 'generating' };
  if (status === 'ready') return label ? { kind: 'value', label } : { kind: 'empty' };
  return { kind: 'masked' };
}
