import { describe, expect, it } from 'vitest';
import { mapErrorResponse } from './errorState';

/**
 * TC-22 (core) — the pure error → safe-display-state classifier (T6.1, FR-11).
 * Covers the by-statusCode dispatch, the 401 interceptor flag, the retryable
 * decision, the validation `fields` seam (TC-36), and the security single-point:
 * a 5xx NEVER surfaces the backend message/stack/fields (NFR-5).
 */
describe('TC-22 · mapErrorResponse (error → safe display state, by statusCode)', () => {
  it('401 → unauthorized, flagged handledByInterceptor (auth redirect owns it), not retryable', () => {
    const m = mapErrorResponse(401);
    expect(m.kind).toBe('unauthorized');
    expect(m.handledByInterceptor).toBe(true);
    expect(m.retryable).toBe(false);
  });

  it('403 → forbidden (not retryable, not interceptor-handled)', () => {
    const m = mapErrorResponse(403);
    expect(m.kind).toBe('forbidden');
    expect(m.handledByInterceptor).toBe(false);
    expect(m.retryable).toBe(false);
  });

  it('404 → notFound (not retryable)', () => {
    const m = mapErrorResponse(404);
    expect(m.kind).toBe('notFound');
    expect(m.retryable).toBe(false);
  });

  it('409 → conflict (not retryable)', () => {
    const m = mapErrorResponse(409);
    expect(m.kind).toBe('conflict');
    expect(m.retryable).toBe(false);
  });

  it('400 → validation and surfaces ErrorResponse.fields for inline field errors (TC-36 seam)', () => {
    const m = mapErrorResponse(400, {
      statusCode: 400,
      code: 'VALIDATION',
      fields: { seeds: ['至少一個種子字'], geo: ['地區為必填'] },
    });
    expect(m.kind).toBe('validation');
    expect(m.retryable).toBe(false);
    expect(m.fields).toEqual({ seeds: ['至少一個種子字'], geo: ['地區為必填'] });
  });

  it('422 → validation; an absent or empty fields map surfaces no fields (no empty object)', () => {
    expect(mapErrorResponse(422).kind).toBe('validation');
    expect(mapErrorResponse(422).fields).toBeUndefined();
    expect(mapErrorResponse(400, { statusCode: 400, fields: {} }).fields).toBeUndefined();
  });

  it('500 → server, retryable, and NEVER leaks the backend message/stack/fields (security single-point)', () => {
    const leaky = {
      statusCode: 500,
      code: 'INTERNAL',
      message: 'TypeError: cannot read x\n    at /app/src/keywords.service.ts:42:13',
      fields: { secret: ['do-not-render'] },
    };
    const m = mapErrorResponse(500, leaky);
    expect(m.kind).toBe('server');
    expect(m.retryable).toBe(true);
    expect(m.message).not.toContain('TypeError');
    expect(m.message).not.toContain('/app/src');
    expect(m.message).not.toContain('do-not-render');
    // fields are surfaced only for validation — a 5xx never carries them through.
    expect(m.fields).toBeUndefined();
  });

  it('any ≥500 (502/503) → server (generic, no leak)', () => {
    expect(mapErrorResponse(502).kind).toBe('server');
    expect(mapErrorResponse(503).kind).toBe('server');
  });

  it('an unrecognised status → unknown (retryable generic)', () => {
    const m = mapErrorResponse(0);
    expect(m.kind).toBe('unknown');
    expect(m.retryable).toBe(true);
    expect(m.message.trim().length).toBeGreaterThan(0);
  });

  it('every kind yields a non-empty, curated message (never a blank error UI)', () => {
    for (const status of [400, 401, 403, 404, 409, 418, 500]) {
      expect(mapErrorResponse(status).message.trim().length).toBeGreaterThan(0);
    }
  });
});
