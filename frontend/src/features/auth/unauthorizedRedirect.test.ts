import { afterEach, describe, expect, it } from 'vitest';
import {
  consumePendingRedirect,
  redirectTargetFor,
  setPendingRedirect,
} from './unauthorizedRedirect';

/**
 * TC-23 — the post-login return target. The pending redirect is captured at
 * 401-intercept time and consumed once after login (SPA-transient module state,
 * not a secret / not persisted). The login page itself is never captured as a
 * return target (avoid returning to /login after logging in).
 */

afterEach(() => setPendingRedirect(null));

describe('TC-23 · pending redirect store', () => {
  it('round-trips a captured href and clears it on consume (single use)', () => {
    setPendingRedirect('/?analysisId=abc');
    expect(consumePendingRedirect()).toBe('/?analysisId=abc');
    expect(consumePendingRedirect()).toBeNull();
  });

  it('is null before anything is captured', () => {
    expect(consumePendingRedirect()).toBeNull();
  });
});

describe('TC-23 · redirectTargetFor', () => {
  it('returns the href for a normal deep link', () => {
    expect(redirectTargetFor('/?analysisId=abc')).toBe('/?analysisId=abc');
    expect(redirectTargetFor('/')).toBe('/');
  });

  it('returns null when already on the login page (no self-return loop)', () => {
    expect(redirectTargetFor('/login')).toBeNull();
    expect(redirectTargetFor('/login?foo=1')).toBeNull();
  });
});
