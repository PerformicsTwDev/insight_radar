import createClient from 'openapi-fetch';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiKeyAuthProvider,
  SessionAuthProvider,
  setApiKey,
  type AuthProvider,
} from '../lib/auth/authProvider';
import type { paths } from './schema';
import {
  createAuthMiddleware,
  setUnauthorizedHandler,
  shouldHandleUnauthorized,
} from './authInterceptor';
import { server } from './msw/server';

/**
 * TC-23 (401 interception) + C9. The auth middleware (a) attaches the current
 * provider's auth headers to every request (session → none; apiKey → `x-api-key`)
 * and (b) routes a global 401 to the registered unauthorized handler — **except**
 * a 401 from the login endpoint itself, which is an in-form credential error, not
 * a session expiry (must not trigger a redirect loop).
 */

function makeClient(provider: AuthProvider) {
  const client = createClient<paths>({
    baseUrl: window.location.origin,
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  });
  client.use(createAuthMiddleware(provider));
  return client;
}

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  setUnauthorizedHandler(null);
  sessionStorage.clear();
});

describe('TC-23 · shouldHandleUnauthorized (pure decision)', () => {
  it('true for a 401 on a non-login path', () => {
    expect(shouldHandleUnauthorized(401, '/api/v1/auth/me')).toBe(true);
  });
  it('false for a 401 on the login path (in-form error, not session expiry)', () => {
    expect(shouldHandleUnauthorized(401, '/api/v1/auth/login')).toBe(false);
  });
  it('false for any non-401 status', () => {
    expect(shouldHandleUnauthorized(200, '/api/v1/auth/me')).toBe(false);
    expect(shouldHandleUnauthorized(500, '/api/v1/auth/me')).toBe(false);
  });
});

describe('TC-23 · header attachment (C9 single token point)', () => {
  it('attaches the x-api-key header from an ApiKeyAuthProvider', async () => {
    setApiKey('k-xyz');
    let received: string | null = null;
    server.use(
      http.get('/api/v1/auth/me', ({ request }) => {
        received = request.headers.get('x-api-key');
        return HttpResponse.json({ id: 'u', email: 'e' });
      }),
    );
    await makeClient(new ApiKeyAuthProvider()).GET('/api/v1/auth/me');
    expect(received).toBe('k-xyz');
  });

  it('attaches no auth header for a SessionAuthProvider (cookie only)', async () => {
    let received: string | null = 'sentinel';
    server.use(
      http.get('/api/v1/auth/me', ({ request }) => {
        received = request.headers.get('x-api-key');
        return HttpResponse.json({ id: 'u', email: 'e' });
      }),
    );
    await makeClient(new SessionAuthProvider()).GET('/api/v1/auth/me');
    expect(received).toBeNull();
  });
});

describe('TC-23 · global 401 interception', () => {
  it('invokes the unauthorized handler on a 401 (non-login path)', async () => {
    let called = 0;
    setUnauthorizedHandler(() => {
      called += 1;
    });
    server.use(http.get('/api/v1/auth/me', () => new HttpResponse(null, { status: 401 })));
    await makeClient(new SessionAuthProvider()).GET('/api/v1/auth/me');
    expect(called).toBe(1);
  });

  it('does NOT invoke the handler on a 401 from the login endpoint', async () => {
    let called = 0;
    setUnauthorizedHandler(() => {
      called += 1;
    });
    server.use(http.post('/api/v1/auth/login', () => new HttpResponse(null, { status: 401 })));
    await makeClient(new SessionAuthProvider()).POST('/api/v1/auth/login', {
      body: { email: 'e', password: 'p' },
    });
    expect(called).toBe(0);
  });

  it('does not invoke the handler on a 2xx response', async () => {
    let called = 0;
    setUnauthorizedHandler(() => {
      called += 1;
    });
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ id: 'u', email: 'e' })));
    await makeClient(new SessionAuthProvider()).GET('/api/v1/auth/me');
    expect(called).toBe(0);
  });

  it('is a no-op (no throw) on a 401 when no handler is registered', async () => {
    setUnauthorizedHandler(null);
    server.use(http.get('/api/v1/auth/me', () => new HttpResponse(null, { status: 401 })));
    await expect(
      makeClient(new SessionAuthProvider()).GET('/api/v1/auth/me'),
    ).resolves.toBeDefined();
  });
});
