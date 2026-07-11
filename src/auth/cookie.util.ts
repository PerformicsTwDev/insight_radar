/**
 * 極簡 cookie header 解析（本案未裝 `cookie-parser`；session cookie 只需按名取值）。
 * 純函式、無相依——把 `Cookie: a=1; b=2` 解成 `{ a: '1', b: '2' }`。
 *
 * - header 缺 → 空物件；
 * - 無 `=` 的片段（畸形）→ 略過；
 * - 名稱為空（如 `=v`）→ 略過；
 * - 值不做 decode：本案唯一要讀的 sid 為 base64url（opaque、無需 URL 解碼），避免 decode 例外面。
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) {
    return jar;
  }
  for (const segment of header.split(';')) {
    const eq = segment.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const name = segment.slice(0, eq).trim();
    if (!name) {
      continue;
    }
    jar[name] = segment.slice(eq + 1).trim();
  }
  return jar;
}
