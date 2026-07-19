import type { AiReference } from './canonical.types';

/**
 * 欄位收斂共用純函式（AC-37.3；Design §18.2/§18.3）——把 extension 各站未統一的欄位命名/形狀收斂為中立形狀。
 * 每個渠道/平台 mapper 以自己的 alias 清單呼叫這些 helper（跨站 `author|channelName|name`、references 形狀…）。
 */

/** payload → `Record` 視圖；非物件（陣列/primitive/null）→ null。 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * 從 record 依 alias 順序取第一個「有值」（非 `undefined`/`null`）的值（`author|channelName|name` 等異名欄位收斂）。
 * `0`/`''` 視為有值（metrics `0` 為真實值、內容空字串由 `coerceString` 另判）。
 */
export function pickAlias(record: Record<string, unknown>, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    const value = record[alias];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

/** 回傳 record 中不在 `recognized` 白名單內的欄位名（未知欄位 → mapStatus partial 早期漂移預警，AC-37.4）。 */
export function collectUnknownFields(
  record: Record<string, unknown>,
  recognized: ReadonlySet<string>,
): string[] {
  return Object.keys(record).filter((key) => !recognized.has(key));
}

/** raw 收件時點（`Date` 或既有 ISO 字串）→ ISO 字串（canonical `capturedAt`）。 */
export function capturedAtToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** 非空字串收斂：trim 後非空 → 該字串；否則（非字串/空白/缺值）→ null。 */
export function coerceString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// references 跨渠道欄位收斂（AC-39.3：AI Overview `{title,link,snippet,source,index}` / Gemini `{name,url}` / …）。
const REF_TITLE_ALIASES = ['title', 'name', 'source_title', 'displayName'] as const;
const REF_LINK_ALIASES = ['link', 'url', 'href'] as const;
const REF_SNIPPET_ALIASES = ['snippet', 'description'] as const;
const REF_SOURCE_ALIASES = ['source', 'publisher', 'site'] as const;

function referenceIndex(record: Record<string, unknown>, fallback: number): number {
  const raw = record.index;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

/**
 * AI 引用統一為 `{title,link,snippet?,source?,index}`（AC-37.3/39.3）。缺（undefined/null/空陣列）→ `[]`
 * （grounding 缺失不編造，§18.3）；非陣列 → `references:not_array` issue；元素非物件 → `reference[i]:not_object`
 * 並跳過（不阻斷其他元素）；缺 link → `reference[i]:missing_link`（仍保留 best-effort）。issue 供 mapStatus 判 partial，
 * 本函式**不拋**。issue 的 `[i]` 為原始陣列位置；輸出 `index` 缺時依保留順序補。
 */
export function normalizeReferences(raw: unknown): { references: AiReference[]; issues: string[] } {
  if (raw === undefined || raw === null) {
    return { references: [], issues: [] };
  }
  if (!Array.isArray(raw)) {
    return { references: [], issues: ['references:not_array'] };
  }

  const references: AiReference[] = [];
  const issues: string[] = [];

  raw.forEach((element, i) => {
    const record = asRecord(element);
    if (!record) {
      issues.push(`reference[${i}]:not_object`);
      return;
    }
    const title = coerceString(pickAlias(record, REF_TITLE_ALIASES)) ?? '';
    const link = coerceString(pickAlias(record, REF_LINK_ALIASES)) ?? '';
    if (link === '') {
      issues.push(`reference[${i}]:missing_link`);
    }
    const reference: AiReference = {
      title,
      link,
      index: referenceIndex(record, references.length),
    };
    const snippet = coerceString(pickAlias(record, REF_SNIPPET_ALIASES));
    if (snippet !== null) {
      reference.snippet = snippet;
    }
    const source = coerceString(pickAlias(record, REF_SOURCE_ALIASES));
    if (source !== null) {
      reference.source = source;
    }
    references.push(reference);
  });

  return { references, issues };
}
