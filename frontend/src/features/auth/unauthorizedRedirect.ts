import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { setUnauthorizedHandler } from '../../api/authInterceptor';
import { authProvider } from '../../api/client';

/**
 * Post-login redirect plumbing (T1.4, FR-12). On a global 401 the interceptor
 * calls the registered handler: it drops any client-held credential, remembers
 * the current URL, and navigates to /login. After a successful login the pending
 * URL is consumed and restored (preserve the original URL for return).
 *
 * The pending redirect is **SPA-transient module state** — not a secret, not
 * persisted; it lives only between the 401 and the next login within the session.
 */

/** Where to return after login. */
let pendingRedirect: string | null = null;

/** Remember the return target (captured at 401-intercept time). */
export function setPendingRedirect(href: string | null): void {
  pendingRedirect = href;
}

/** Read + clear the pending redirect (single use). */
export function consumePendingRedirect(): string | null {
  const href = pendingRedirect;
  pendingRedirect = null;
  return href;
}

/** Return target for a login redirect: `null` when already on /login (no self-loop). */
export function redirectTargetFor(href: string): string | null {
  return href.startsWith('/login') ? null : href;
}

/**
 * Capture the return target from a 401 at the given current href. Concurrent
 * protected requests (dashboard queries + `useJobTracking` polling) can 401 in a
 * burst: the first captures the real deep link and starts navigating to /login;
 * a later one, firing after the location has already become /login, computes a
 * `null` target — it must **not** overwrite the first (real) target with `null`
 * (that would drop the user to `/` after re-login, violating AC-12.1). So only a
 * non-null target is recorded.
 */
export function capturePendingRedirect(href: string): void {
  const target = redirectTargetFor(href);
  if (target !== null) setPendingRedirect(target);
}

/**
 * Wire the global 401 handler to this router — call once, in the root layout.
 * Clears the handler on unmount so tests/hot-reload don't leak a stale router.
 */
export function useUnauthorizedRedirect(): void {
  const router = useRouter();
  useEffect(() => {
    setUnauthorizedHandler(() => {
      authProvider.onUnauthorized();
      capturePendingRedirect(router.state.location.href);
      void router.navigate({ to: '/login' });
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);
}
