import type { AiSearchCanonical, MapperInput, MapResult } from './canonical.types';
import {
  asRecord,
  capturedAtToIso,
  coerceString,
  collectUnknownFields,
  normalizeReferences,
  pickAlias,
} from './coalesce';
import { failResult } from './map-result';

/**
 * AI 線 mapper 骨架（FR-37/39；Design §18.3）——raw payload → `AiSearchCapture` 中立形狀（純函式）。
 *
 * 核心欄位 = `query`（缺 → failed）；`blocks` 收斂為陣列（缺 → partial + `[]`）；`references` 統一為
 * `{title,link,snippet?,source?,index}`（缺 → `[]`，grounding 缺失不編造）。未知欄位 → partial（漂移預警，AC-37.4）。
 * `raw` 恆保留（INV-4）。
 *
 * ⚠ 邊界（T13.4 ↔ T13.5/T14.4）：此為**線層骨架**，recognized-field 白名單刻意精簡（代表性 alias）；per-channel
 * 實欄位與 golden fixture（extension `type.ts` 權威）屬 T13.5 / T14.4，屆時擴充白名單與 blocks 內部結構。
 */
const QUERY_ALIASES = ['query', 'keyword', 'q', 'prompt', 'question'] as const;
const BLOCKS_ALIASES = [
  'blocks',
  'textBlocks',
  'text_blocks',
  'answer',
  'reconstructedMarkdown',
  'reconstructed_markdown',
  'markdown',
] as const;
const REFERENCES_ALIASES = ['references', 'sources', 'citations', 'cited'] as const;

const RECOGNIZED = new Set<string>([...QUERY_ALIASES, ...BLOCKS_ALIASES, ...REFERENCES_ALIASES]);

/** blocks 收斂為中立陣列：陣列原樣；字串包成單元素；缺 → `[]` + issue；其他 primitive/物件 → 包成單元素。 */
function toBlocks(value: unknown, reasons: string[]): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    reasons.push('missing:blocks');
    return [];
  }
  return [value];
}

export function mapAiCapture(input: MapperInput): MapResult<AiSearchCanonical> {
  const raw = input.payload;
  if (!input.channel) {
    return failResult(raw, 'missing_channel');
  }
  const record = asRecord(raw);
  if (!record) {
    return failResult(raw, 'payload_not_object');
  }

  const reasons: string[] = [];
  const query = coerceString(pickAlias(record, QUERY_ALIASES));
  const blocks = toBlocks(pickAlias(record, BLOCKS_ALIASES), reasons);
  const { references, issues } = normalizeReferences(pickAlias(record, REFERENCES_ALIASES));
  reasons.push(...issues);
  for (const field of collectUnknownFields(record, RECOGNIZED)) {
    reasons.push(`unknown_field:${field}`);
  }

  if (query === null) {
    return { mapStatus: 'failed', canonical: null, raw, reasons: ['missing:query', ...reasons] };
  }

  const canonical: AiSearchCanonical = {
    source: input.source,
    channel: input.channel,
    schemaVersion: input.schemaVersion,
    query,
    blocks,
    references,
    capturedAt: capturedAtToIso(input.capturedAt),
  };
  return { mapStatus: reasons.length === 0 ? 'ok' : 'partial', canonical, raw, reasons };
}
