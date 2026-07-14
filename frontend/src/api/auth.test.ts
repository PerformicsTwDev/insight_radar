import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMe, login, logout } from './auth';
import { server } from './msw/server';

/**
 * TC-39 — auth login / logout / me contract (session-cookie behaviour). The
 * frontend **never reads the token**: on login the opaque session lives only in
 * the httpOnly Set-Cookie (backend-owned); the response body carries just the
 * user. Bodies are runtime-zod-validated (openapi gap #392: auth responses have
 * no schema → codegen types them `never`). Egress goes through the typed `api`
 * client — never a bare fetch.
 */

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  sessionStorage.clear();
});

describe('TC-39 · login (POST /auth/login)', () => {
  it('sends the typed credentials and returns the user on 200 (cookie set by backend)', async () => {
    let received: unknown;
    server.use(
      http.post('/api/v1/auth/login', async ({ request }) => {
        received = await request.json();
        // Backend sets an httpOnly session cookie; body carries only the user.
        return HttpResponse.json(
          { user: { id: 'u-1', email: 'user@example.com' } },
          { status: 200, headers: { 'set-cookie': 'ir.sid=opaque; HttpOnly; Path=/' } },
        );
      }),
    );

    const result = await login({ email: 'user@example.com', password: 'pw' });

    expect(result).toEqual({ ok: true, user: { id: 'u-1', email: 'user@example.com' } });
    expect(received).toEqual({ email: 'user@example.com', password: 'pw' });
  });

  it('returns ok:false with status 401 on invalid credentials (no enumeration)', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(
          { statusCode: 401, code: 'UNAUTHORIZED', message: 'Invalid email or password' },
          { status: 401 },
        ),
      ),
    );

    const result = await login({ email: 'user@example.com', password: 'wrong' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error?.message).toBe('Invalid email or password');
    }
  });

  it('returns ok:false when the 200 body is not a valid user shape', async () => {
    server.use(
      http.post('/api/v1/auth/login', () => HttpResponse.json({ user: {} }, { status: 200 })),
    );

    const result = await login({ email: 'user@example.com', password: 'pw' });

    expect(result.ok).toBe(false);
  });
});

describe('TC-39 · logout (POST /auth/logout)', () => {
  it('returns true when the backend accepts the logout', async () => {
    server.use(http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 200 })));
    expect(await logout()).toBe(true);
  });

  it('returns false when the logout is rejected (e.g. 401 no session)', async () => {
    server.use(http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 401 })));
    expect(await logout()).toBe(false);
  });
});

describe('TC-39 · me (GET /auth/me)', () => {
  it('returns the current user on 200', async () => {
    server.use(
      http.get('/api/v1/auth/me', () =>
        HttpResponse.json({ id: 'u-1', email: 'user@example.com' }, { status: 200 }),
      ),
    );
    expect(await getMe()).toEqual({ id: 'u-1', email: 'user@example.com' });
  });

  it('returns null on 401 (no / expired session)', async () => {
    server.use(http.get('/api/v1/auth/me', () => new HttpResponse(null, { status: 401 })));
    expect(await getMe()).toBeNull();
  });

  it('returns null when the 200 body fails validation', async () => {
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ id: 42 }, { status: 200 })));
    expect(await getMe()).toBeNull();
  });
});
