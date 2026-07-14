import type { components } from './schema';

/** — RED STUB — */

export type LoginBody = components['schemas']['LoginDto'];

export interface AuthUser {
  readonly id: string;
  readonly email: string;
}

export type LoginResult =
  { readonly ok: true; readonly user: AuthUser } | { readonly ok: false; readonly status: number };

export async function login(_body: LoginBody): Promise<LoginResult> {
  return Promise.reject(new Error('not implemented'));
}

export async function logout(): Promise<boolean> {
  return Promise.reject(new Error('not implemented'));
}

export async function getMe(): Promise<AuthUser | null> {
  return Promise.reject(new Error('not implemented'));
}
