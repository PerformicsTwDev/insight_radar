import { z } from 'zod';
import { api } from './client';
import { ErrorResponseSchema, type ErrorResponse } from './keywordAnalyses';
import type { components } from './schema';

/**
 * Typed auth egress (T1.4, FR-12; TC-39) — login / logout / me. Business code
 * calls these, never a bare `fetch` (single-egress, Design §2/§3).
 *
 * **openapi gap (deviation, documented — #392):** the backend `openapi.json`
 * describes the auth 2xx responses with *no* body schema, so the codegen types
 * them `never`. openapi-fetch still parses the JSON at runtime; we validate those
 * untyped bodies here with zod against the backend contract (`AuthController`:
 * login/register → `{ user:{id,email} }`, `me` → bare `{id,email}`). The
 * **request** body stays bound to the generated `LoginDto`, so request-shape
 * drift is still a compile error.
 *
 * The frontend **never reads the session token**: on login the opaque session is
 * set as an httpOnly cookie (backend-owned); the body carries only the user.
 */

/** Request body — bound to the generated openapi DTO (drift → compile error). */
export type LoginBody = components['schemas']['LoginDto'];

/** Authenticated user (the only identity the frontend ever holds). */
export const AuthUserSchema = z.object({ id: z.string().min(1), email: z.string().min(1) });
export type AuthUser = z.infer<typeof AuthUserSchema>;

/** login / register 2xx body (not in openapi): `{ user }`. */
const UserEnvelopeSchema = z.object({ user: AuthUserSchema });

export type LoginResult =
  | { readonly ok: true; readonly user: AuthUser }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

/**
 * Log in with email + password. On success the backend sets the httpOnly session
 * cookie and returns `{ user }` (zod-validated). On any non-2xx the body is
 * parsed as `ErrorResponse` (a 401 is a generic "invalid credentials" — the UI
 * must not enumerate which field was wrong). A 2xx whose body is not a valid user
 * degrades to `ok:false`.
 */
export async function login(body: LoginBody): Promise<LoginResult> {
  const { data, error, response } = await api.POST('/api/v1/auth/login', { body });

  if (response.ok) {
    const parsed = UserEnvelopeSchema.safeParse(data);
    if (parsed.success) return { ok: true, user: parsed.data.user };
    return { ok: false, status: response.status };
  }

  const parsedError = ErrorResponseSchema.safeParse(error);
  return {
    ok: false,
    status: response.status,
    error: parsedError.success ? parsedError.data : undefined,
  };
}

/** Log out (revoke the session + clear the cookie). Returns whether the backend accepted it. */
export async function logout(): Promise<boolean> {
  const { response } = await api.POST('/api/v1/auth/logout');
  return response.ok;
}

/**
 * Fetch the current user (`GET /auth/me`) — used to bootstrap auth state. A
 * non-2xx (401 = no / expired session) or a body that fails validation degrades
 * to `null` (caller treats it as "not authenticated") rather than throwing.
 */
export async function getMe(): Promise<AuthUser | null> {
  const { data, response } = await api.GET('/api/v1/auth/me');
  if (!response.ok) return null;
  const parsed = AuthUserSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
