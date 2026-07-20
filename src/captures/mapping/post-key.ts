/**
 * postKey 正規化（S13 / AC-46.1；Design §18.5）——純函式。`normalize(permalink/url)` = 跨來源/跨平台
 * **唯一去重鍵**：去 fragment、去 query string、去尾斜線、**只收斂 scheme+host 大小寫**。
 *
 * ⚠ **只 lowercase scheme+host（authority），保留 path/shortcode 大小寫**：permalink 的 path/shortcode 大小寫敏感
 * （`/post/AbC` ≠ `/post/abc` 為不同貼文）——整串 lowercase 會使不同貼文於 `@@unique([jobId,postKey])` 碰撞。
 * 故同貼文不同 query/host 大小寫 → 同一 key；不同 path 大小寫 → 不同 key。
 *
 * 缺值 / 非字串 / 空 → **null**（無法產生去重鍵）。
 *
 * ⚠ 邊界：本函式僅產生去重鍵；跨來源 merge 語意（同 postKey 多來源 → metrics 取 extension、全文取較長、
 * `source=merged`）屬 FR-46（T16.5），**非本 task**。
 */

// `scheme://` + authority（host[:port]，至 path/query/fragment 前）+ 其餘（path…）。
const SCHEME_AUTHORITY = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/?#]*)(.*)$/;

/** 只收斂 scheme+host 大小寫；path/query（此時已剝除）保留原樣。 */
function lowercaseHost(url: string): string {
  const match = SCHEME_AUTHORITY.exec(url);
  if (match) {
    return match[1].toLowerCase() + match[2].toLowerCase() + match[3];
  }
  // 無 `scheme://`（scheme-less / 非標準）→ 把第一個 '/' 前視為 host 收斂，其餘保留。
  const slash = url.indexOf('/');
  if (slash < 0) {
    return url.toLowerCase();
  }
  return url.slice(0, slash).toLowerCase() + url.slice(slash);
}

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
  key = lowercaseHost(key.replace(/\/+$/, ''));

  return key === '' ? null : key;
}
