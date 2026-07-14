import { afterEach, describe, expect, it } from 'vitest';
import {
  capturePendingRedirect,
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

describe('TC-23 · capturePendingRedirect (concurrent-401 safe)', () => {
  it('captures a normal deep link on a 401', () => {
    capturePendingRedirect('/?analysisId=xyz');
    expect(consumePendingRedirect()).toBe('/?analysisId=xyz');
  });

  it('does not overwrite the first captured deep link when a later 401 fires after nav to /login', () => {
    // Burst of concurrent protected-request 401s: the 1st captures the real target
    // and starts navigating; the 2nd fires once location is already /login → target
    // computes null and must NOT clobber the 1st (AC-12.1 保留原 URL).
    capturePendingRedirect('/?analysisId=abc'); // 1st 401 (real deep link)
    capturePendingRedirect('/login'); // 2nd 401 (already redirecting)
    expect(consumePendingRedirect()).toBe('/?analysisId=abc');
  });

  it('leaves the pending target untouched when the only 401 fires already on /login', () => {
    capturePendingRedirect('/login');
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
