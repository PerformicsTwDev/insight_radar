import type { AiReference } from './canonical.types';

/**
 * 欄位收斂共用純函式（AC-37.3；Design §18.2/§18.3）——把 extension 各站未統一的欄位命名/形狀收斂為中立形狀。
 *
 * TODO(T13.4): 實作。
 */

/** payload → `Record` 視圖；非物件（陣列/primitive/null）→ null。 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  void value;
  return null;
}

/** 從 record 依 alias 順序取第一個「有值」（非 undefined/null）的值（`author|channelName|name` 等異名欄位收斂）。 */
export function pickAlias(record: Record<string, unknown>, aliases: readonly string[]): unknown {
  void record;
  void aliases;
  return undefined;
}

/** 回傳 record 中不在 `recognized` 白名單內的欄位名（未知欄位 → mapStatus partial 早期漂移預警，AC-37.4）。 */
export function collectUnknownFields(
  record: Record<string, unknown>,
  recognized: ReadonlySet<string>,
): string[] {
  void record;
  void recognized;
  return [];
}

/** 非空字串收斂：trim 後非空 → 該字串；否則（非字串/空白/缺值）→ null。 */
export function coerceString(value: unknown): string | null {
  void value;
  return null;
}

/**
 * AI 引用統一為 `{title,link,snippet?,source?,index}`（AC-37.3/39.3）。缺 → `[]`（grounding 缺失不編造）；
 * 形狀不符 → 收集 `issues`（供 mapStatus 判 partial），**不拋**。
 */
export function normalizeReferences(raw: unknown): { references: AiReference[]; issues: string[] } {
  void raw;
  return { references: [], issues: [] };
}
