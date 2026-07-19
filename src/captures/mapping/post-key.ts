/**
 * postKey 正規化（S13 / AC-46.1；Design §18.5）——純函式。`normalize(permalink/url)` = 跨來源/跨平台
 * **唯一去重鍵**：去 fragment、去 query string、去尾斜線、大小寫收斂。同貼文不同 query/大小寫 → 同一 key。
 *
 * 缺值 / 非字串 / 空 → **null**（無法產生去重鍵）。
 *
 * ⚠ 邊界：本函式僅產生去重鍵；跨來源 merge 語意（同 postKey 多來源 → metrics 取 extension、全文取較長、
 * `source=merged`）屬 FR-46（T16.5），**非本 task**。
 */
export function normalizePostKey(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  let key = value.trim();
  const hash = key.indexOf('#');
  if (hash >= 0) {
    key = key.slice(0, hash);
  }
  const query = key.indexOf('?');
  if (query >= 0) {
    key = key.slice(0, query);
  }
  key = key.replace(/\/+$/, '').toLowerCase();

  return key === '' ? null : key;
}
