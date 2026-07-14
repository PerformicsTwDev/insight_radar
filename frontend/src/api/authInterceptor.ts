import type { Middleware } from 'openapi-fetch';
import type { AuthProvider } from '../lib/auth/authProvider';

/**
 * openapi-fetch middleware for auth (T1.4, FR-12; C9). Two concerns:
 * 1. **Request:** merge the current provider's auth headers onto every request
 *    (session → none; apiKey → `x-api-key`). The provider is the single point
 *    that reads the credential.
 * 2. **Response:** route a global 401 to the app-registered handler (clear state
 *    + redirect to /login) — **except** a 401 from the login call itself, which
 *    is an in-form "invalid credentials" error, not a session expiry (routing it
 *    would loop the user back to the page they are already on).
 */

/** App-registered 401 reaction (provider.onUnauthorized + router redirect); null until wired. */
let onUnauthorized: (() => void) | null = null;

/** Register (or clear, with `null`) the global 401 handler. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** A 401 needs global handling unless it is the login call's own credential error. */
export function shouldHandleUnauthorized(status: number, schemaPath: string): boolean {
  return status === 401 && schemaPath !== '/api/v1/auth/login';
}

/** Build the auth middleware bound to `provider`. Registered once on the api client. */
export function createAuthMiddleware(provider: AuthProvider): Middleware {
  return {
    onRequest({ request }) {
      for (const [name, value] of Object.entries(provider.getAuthHeaders())) {
        request.headers.set(name, value);
      }
      return request;
    },
    onResponse({ response, schemaPath }) {
      if (shouldHandleUnauthorized(response.status, schemaPath)) {
        onUnauthorized?.();
      }
      return response;
    },
  };
}
