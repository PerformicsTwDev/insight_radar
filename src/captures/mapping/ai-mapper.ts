import type { AiSearchCanonical, MapperInput, MapResult } from './canonical.types';

/**
 * AI 線 mapper 骨架（FR-37/39；Design §18.3）——raw payload → `AiSearchCapture` 中立形狀（純函式）。
 *
 * TODO(T13.4): 實作。
 */
export function mapAiCapture(input: MapperInput): MapResult<AiSearchCanonical> {
  return { mapStatus: 'failed', canonical: null, raw: input.payload, reasons: ['not_implemented'] };
}
