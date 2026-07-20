import type { CaptureChannel } from '../dto/capture-ingest.dto';
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
 * AI 線 mapper（FR-39；Design §18.3 / AC-39.1~39.3）——四渠道 `chatGpt/geminiApp/googleAiMode/googleSearch` 的 raw
 * payload → `AiSearchCapture` 中立形狀（純函式）。S20：每渠道一 mapper，但 AI 線共用單一 channel-aware 純函式（registry
 * 對每個 channel 註冊本函式），內部依 `channel` 分派 per-channel 認得欄位與收斂規則。
 *
 * 中立形狀（§18.3 `AiSearchCapture` model 投影）＝`{source,channel,schemaVersion,query,blocks,references,capturedAt}`：
 * - `query`（缺 → failed，核心欄）。
 * - `blocks` 收斂為陣列（缺 → partial + `[]`）。
 * - `references` 統一為 `{title,link,snippet?,source?,index}`（跨渠道；`normalizeReferences` 共用，供 SerpAPI 來源
 *   T14.2 沿用同一中立形狀）；grounding 缺失 → `[]`（不編造，S17）。
 * - **per-channel 認得欄位**（`relatedQuestions`/`organicResults`/`turns`）為 auxiliary raw 欄位：`§18.3` model 無對應
 *   中立欄 → **不投影進 canonical**，僅保留於 `raw`（INV-4，可 reparse），且**渠道專屬**（不跨渠道外洩，否則削弱漂移守衛）。
 * - 白名單外欄位 → partial（漂移預警，AC-37.4）。`raw` 恆保留（INV-4）。
 *
 * ChatGPT 多輪（AC-39.2）：外部橋接僅單輪、`ChatGptResponseFormat` 凍結為最後一輪 → payload 若含 `turns[]`，只取**最後
 * 一輪（可得輪）**的 answer + references（不串接前輪、缺則退回 top-level、不編造）。
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

/** 跨渠道共用的核心認得欄位（query/blocks/references 的所有 alias）。 */
const SHARED_RECOGNIZED: readonly string[] = [
  ...QUERY_ALIASES,
  ...BLOCKS_ALIASES,
  ...REFERENCES_ALIASES,
];

/**
 * per-channel 額外認得欄位（Design §18.3；渠道專屬 auxiliary raw 欄位，保留於 raw、不投影進 canonical）。
 * **渠道範圍嚴格**：`relatedQuestions` 只於 `googleAiMode` 認得、`organicResults` 只於 `googleSearch`、`turns` 只於
 * `chatGpt`——搬到別渠道即回 `unknown_field`（漂移守衛不外洩，S20/AC-37.4）。aiOverview/aiMode/bingCopilot 為 SerpAPI
 * reserved（本期不填 per-channel 欄位，走共用骨架）。
 */
const CHANNEL_EXTRA_RECOGNIZED: Partial<Record<CaptureChannel, readonly string[]>> = {
  chatGpt: ['turns'],
  googleAiMode: ['relatedQuestions'],
  googleSearch: ['organicResults'],
};

/** 該渠道的認得欄位白名單（共用核心 ∪ per-channel 額外欄位）。 */
function recognizedFor(channel: CaptureChannel): ReadonlySet<string> {
  return new Set<string>([...SHARED_RECOGNIZED, ...(CHANNEL_EXTRA_RECOGNIZED[channel] ?? [])]);
}

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

/**
 * ChatGPT 凍結末輪（AC-39.2）：payload 若含非空 `turns[]` 且末元素為物件 → 回該輪的 blocks/references 來源（只取可得的
 * 最後一輪）。turns 缺/空/末元素非物件 → `null`（呼叫端退回 top-level，不編造）。
 */
function resolveChatGptTurn(
  record: Record<string, unknown>,
): { blocks: unknown; references: unknown } | null {
  const turns = record.turns;
  if (!Array.isArray(turns) || turns.length === 0) {
    return null;
  }
  const lastTurn = asRecord(turns[turns.length - 1]);
  if (!lastTurn) {
    return null;
  }
  return {
    blocks: pickAlias(lastTurn, BLOCKS_ALIASES),
    references: pickAlias(lastTurn, REFERENCES_ALIASES),
  };
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

  const channel = input.channel;
  const reasons: string[] = [];
  const query = coerceString(pickAlias(record, QUERY_ALIASES));

  // ChatGPT 多輪：凍結末輪優先，缺則退回 top-level（AC-39.2）。其餘渠道直接取 top-level。
  const frozenTurn = channel === 'chatGpt' ? resolveChatGptTurn(record) : null;
  const blocksSource = frozenTurn ? frozenTurn.blocks : pickAlias(record, BLOCKS_ALIASES);
  const referencesSource = frozenTurn
    ? frozenTurn.references
    : pickAlias(record, REFERENCES_ALIASES);

  const blocks = toBlocks(blocksSource, reasons);
  const { references, issues } = normalizeReferences(referencesSource);
  reasons.push(...issues);
  for (const field of collectUnknownFields(record, recognizedFor(channel))) {
    reasons.push(`unknown_field:${field}`);
  }

  if (query === null) {
    return { mapStatus: 'failed', canonical: null, raw, reasons: ['missing:query', ...reasons] };
  }

  const canonical: AiSearchCanonical = {
    source: input.source,
    channel,
    schemaVersion: input.schemaVersion,
    query,
    blocks,
    references,
    capturedAt: capturedAtToIso(input.capturedAt),
  };
  return { mapStatus: reasons.length === 0 ? 'ok' : 'partial', canonical, raw, reasons };
}
