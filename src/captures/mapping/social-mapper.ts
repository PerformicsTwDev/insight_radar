import type { MapperInput, MapResult, SocialPostCanonical } from './canonical.types';

/**
 * Social 線 mapper 骨架（FR-37/46/51；Design §18.5）——raw payload → `SocialPost` 中立形狀（純函式）。
 *
 * TODO(T13.4): 實作。
 */
export function mapSocialPost(input: MapperInput): MapResult<SocialPostCanonical> {
  return { mapStatus: 'failed', canonical: null, raw: input.payload, reasons: ['not_implemented'] };
}
