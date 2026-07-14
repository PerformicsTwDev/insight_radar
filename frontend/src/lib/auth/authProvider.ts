/**
 * Auth provider abstraction (T1.4, FR-12; Design §7 correctness-point C9). Two
 * interchangeable implementations share one interface so switching auth mode
 * touches only the provider + the login page — **business components are
 * unchanged**:
 * - {@link SessionAuthProvider} (production): the browser attaches an httpOnly
 *   session cookie automatically, so JS sends **zero** auth headers and never
 *   reads any token (NFR-5).
 * - {@link ApiKeyAuthProvider} (dev / machine): sends the transitional
 *   `x-api-key` header, read from **sessionStorage only** — never localStorage,
 *   never the bundle, never `.env` (NFR-5).
 *
 * `getApiKey` / `setApiKey` / `clearApiKey` are the **single read/write point**
 * for the api key (C9): no component reaches into storage directly.
 */

export type AuthProviderKind = 'session' | 'apiKey';

/** The single seam business code depends on. `getAuthHeaders` runs per request. */
export interface AuthProvider {
  readonly kind: AuthProviderKind;
  /** Auth headers to merge onto every outgoing request (session → none). */
  getAuthHeaders(): Record<string, string>;
  /** React to a global 401: drop any client-held credential (session → no-op). */
  onUnauthorized(): void;
}

/** sessionStorage key for the transitional api key. sessionStorage clears on tab close. */
const API_KEY_STORAGE_KEY = 'insight-radar.apiKey';

/** C9 single read point for the api key. */
export function getApiKey(): string | null {
  return sessionStorage.getItem(API_KEY_STORAGE_KEY);
}

/** C9 single write point — sessionStorage only (NFR-5: never localStorage / bundle / .env). */
export function setApiKey(key: string): void {
  sessionStorage.setItem(API_KEY_STORAGE_KEY, key);
}

/** C9 single clear point (used on logout / a 401 that invalidates the key). */
export function clearApiKey(): void {
  sessionStorage.removeItem(API_KEY_STORAGE_KEY);
}

/** Production auth: httpOnly session cookie, browser-attached; JS holds no token. */
export class SessionAuthProvider implements AuthProvider {
  readonly kind = 'session' as const;

  getAuthHeaders(): Record<string, string> {
    return {}; // cookie is sent automatically (credentials: 'include'); no JS header
  }

  onUnauthorized(): void {
    // No-op: the session cookie is httpOnly and backend-owned — JS holds no auth
    // state to clear. The interceptor still redirects to /login.
  }
}

/** Dev / machine auth: `x-api-key` header from sessionStorage. */
export class ApiKeyAuthProvider implements AuthProvider {
  readonly kind = 'apiKey' as const;

  getAuthHeaders(): Record<string, string> {
    const key = getApiKey();
    return key ? { 'x-api-key': key } : {};
  }

  onUnauthorized(): void {
    clearApiKey(); // the stored key is stale/invalid — drop it
  }
}

/** Build the provider selected by `VITE_AUTH_PROVIDER` (Design §14). */
export function createAuthProvider(kind: AuthProviderKind): AuthProvider {
  return kind === 'apiKey' ? new ApiKeyAuthProvider() : new SessionAuthProvider();
}
