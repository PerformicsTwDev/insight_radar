import type { Middleware } from 'openapi-fetch';
import type { AuthProvider } from '../lib/auth/authProvider';

/** — RED STUB — */

export function shouldHandleUnauthorized(_status: number, _schemaPath: string): boolean {
  return false;
}

export function setUnauthorizedHandler(_handler: (() => void) | null): void {
  /* stub */
}

export function createAuthMiddleware(_provider: AuthProvider): Middleware {
  return { onRequest: ({ request }) => request };
}
