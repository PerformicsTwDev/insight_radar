/**
 * Shared tracking-list error → readable prompt classifier (T5.5, FR-19; backend FR-28 ·
 * AC-28.1/28.2/28.5/28.7). The inline error convention the CRUD view uses across
 * create / rename / delete / remove-member; T6.1 later hoists it into a shared
 * toast/banner. Each failure code gets its OWN line (never one generic sentence, per the
 * FR-19 boundary):
 *
 * - **400** — a member's geo/language does not match the list context (AC-28.5).
 * - **404** — the list/member is gone or not owned (the owner-scoped 404, AC-27.3/27.4).
 * - **409** — two distinct causes the backend returns with the SAME `code` (`CONFLICT`):
 *   a size cap (list-count / member-count, AC-28.7) vs a duplicate name (AC-28.1/28.2).
 *   The only signal that separates them is the `ErrorResponse.message` string, so a
 *   `… limit reached …` message ⇒ cap prompt, and anything else (incl. no message) ⇒
 *   name-collision prompt (the dominant 409 in create/rename). **Deviation (documented):**
 *   this couples to the backend English message because the contract exposes no
 *   machine-readable sub-code; a backend `code` split would let us drop the string match.
 * - **anything else** — a generic retry prompt.
 */

const GEO_LANGUAGE_MISMATCH = '所選項目的地區 / 語言與清單設定不符，無法加入。';
const NOT_FOUND = '找不到這個清單或成員（可能已被刪除，或你沒有存取權限）。';
const CAP_REACHED = '數量已達上限，請先移除部分清單或成員後再試。';
const NAME_TAKEN = '清單名稱已存在，請換一個名稱。';
const GENERIC = '操作失敗，請稍後再試。';

/** True when a 409 body says a count cap was hit (list or member limit; AC-28.7). */
function isCapReached(message?: string): boolean {
  return message !== undefined && message.toLowerCase().includes('limit reached');
}

/**
 * Map a failed tracking-list request to its own readable prompt. `message` is the
 * backend `ErrorResponse.message` (only consulted to split the two 409 causes).
 */
export function trackingListErrorMessage(status: number, message?: string): string {
  switch (status) {
    case 400:
      return GEO_LANGUAGE_MISMATCH;
    case 404:
      return NOT_FOUND;
    case 409:
      return isCapReached(message) ? CAP_REACHED : NAME_TAKEN;
    default:
      return GENERIC;
  }
}

/**
 * Narrow an `ErrorResponse.message` (`string | string[] | undefined`) to the single string
 * {@link trackingListErrorMessage} consults to split the two 409 causes. Only a plain string
 * can carry the `… limit reached …` cap signal; a validation `string[]` or an absent message
 * maps to `undefined` (→ the default 409 = name collision). Colocated with the classifier so
 * every tracking-list error surface (CRUD view + bulk bar) extracts the message ONE way.
 */
export function errorResponseMessage(error?: { message?: string | string[] }): string | undefined {
  return typeof error?.message === 'string' ? error.message : undefined;
}
