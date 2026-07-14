import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiKeyAuthProvider,
  clearApiKey,
  createAuthProvider,
  getApiKey,
  setApiKey,
  SessionAuthProvider,
} from './authProvider';

/**
 * TC-23 / TC-39 — auth provider abstraction (C9 single token read-point) + NFR-5
 * (the transitional `x-api-key` lives in **sessionStorage only**, never
 * localStorage / bundle / .env). Session auth carries **zero** JS headers (the
 * httpOnly cookie is browser-attached and never read by JS).
 */

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('TC-39 · x-api-key storage (C9 single read/write point, NFR-5)', () => {
  it('getApiKey is null before any key is stored', () => {
    expect(getApiKey()).toBeNull();
  });

  it('setApiKey persists to sessionStorage and getApiKey reads it back', () => {
    setApiKey('k-123');
    expect(getApiKey()).toBe('k-123');
  });

  it('never writes the key to localStorage (NFR-5: no secret in localStorage/bundle)', () => {
    setApiKey('k-secret');
    expect(localStorage.length).toBe(0);
    // …and the value is not discoverable anywhere in localStorage.
    for (let i = 0; i < localStorage.length; i++) {
      expect(localStorage.getItem(localStorage.key(i)!)).not.toContain('k-secret');
    }
  });

  it('clearApiKey removes the stored key', () => {
    setApiKey('k-123');
    clearApiKey();
    expect(getApiKey()).toBeNull();
  });
});

describe('TC-23 · SessionAuthProvider (cookie, zero JS headers)', () => {
  const provider = new SessionAuthProvider();

  it('has kind "session"', () => {
    expect(provider.kind).toBe('session');
  });

  it('getAuthHeaders returns no headers (cookie is browser-attached, JS never reads it)', () => {
    expect(provider.getAuthHeaders()).toEqual({});
  });

  it('onUnauthorized is a no-op (httpOnly cookie is backend-owned; no JS state to clear)', () => {
    setApiKey('unrelated'); // must not be touched by the session provider
    expect(() => provider.onUnauthorized()).not.toThrow();
    expect(getApiKey()).toBe('unrelated');
  });
});

describe('TC-23 · ApiKeyAuthProvider (x-api-key header from sessionStorage)', () => {
  const provider = new ApiKeyAuthProvider();

  it('has kind "apiKey"', () => {
    expect(provider.kind).toBe('apiKey');
  });

  it('getAuthHeaders returns {} when no key is stored', () => {
    expect(provider.getAuthHeaders()).toEqual({});
  });

  it('getAuthHeaders returns the x-api-key header when a key is stored', () => {
    setApiKey('k-abc');
    expect(provider.getAuthHeaders()).toEqual({ 'x-api-key': 'k-abc' });
  });

  it('onUnauthorized clears the stored key (drop invalid machine credential)', () => {
    setApiKey('k-abc');
    provider.onUnauthorized();
    expect(getApiKey()).toBeNull();
    expect(provider.getAuthHeaders()).toEqual({});
  });
});

describe('TC-23 · createAuthProvider (selected by VITE_AUTH_PROVIDER)', () => {
  it('returns a SessionAuthProvider for "session"', () => {
    expect(createAuthProvider('session')).toBeInstanceOf(SessionAuthProvider);
  });

  it('returns an ApiKeyAuthProvider for "apiKey"', () => {
    expect(createAuthProvider('apiKey')).toBeInstanceOf(ApiKeyAuthProvider);
  });
});
