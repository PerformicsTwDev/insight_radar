import { describe, expect, it } from 'vitest';
import { EM_DASH } from './keywordsTable';
import { formatDateTime } from './datetime';

/**
 * #651 — history timestamps must convert the backend UTC ISO to a local
 * wall-clock, not string-slice it (which showed UTC as a bare wall-clock).
 *
 * TZ-deterministic: every conversion assertion passes an EXPLICIT `timeZone`,
 * so the expectation never depends on the CI runner's default TZ. The regression
 * anchor: a TW (UTC+8) analyst who created an analysis at 20:34 local time saw
 * the bare UTC wall-clock '12:34'.
 */
describe('formatDateTime (#651 · UTC ISO → local wall-clock)', () => {
  it('converts a UTC instant to the target-zone wall-clock (Asia/Taipei, +8)', () => {
    // 12:34 UTC is 20:34 in Taipei — NOT the bare-sliced '12:34'.
    expect(formatDateTime('2026-07-17T12:34:56Z', 'Asia/Taipei')).toBe('2026-07-17 20:34');
  });

  it('rolls the calendar day when the zone offset crosses midnight', () => {
    // 20:00 UTC on the 17th is 04:00 on the 18th in Taipei.
    expect(formatDateTime('2026-07-17T20:00:00Z', 'Asia/Taipei')).toBe('2026-07-18 04:00');
    // 16:00 UTC → exactly local midnight (00:00, not 24:00) on the next day.
    expect(formatDateTime('2026-07-17T16:00:00Z', 'Asia/Taipei')).toBe('2026-07-18 00:00');
  });

  it('renders in UTC when UTC is the requested zone', () => {
    expect(formatDateTime('2026-07-17T12:34:56Z', 'UTC')).toBe('2026-07-17 12:34');
  });

  it('handles a negative offset zone (America/New_York, -4 DST)', () => {
    // 02:30 UTC on the 17th is 22:30 on the 16th in New York (EDT, -4).
    expect(formatDateTime('2026-07-17T02:30:00Z', 'America/New_York')).toBe('2026-07-16 22:30');
  });

  it('zero-pads single-digit months / days / hours / minutes', () => {
    expect(formatDateTime('2026-01-05T01:09:00Z', 'UTC')).toBe('2026-01-05 01:09');
  });

  it('falls back to an em-dash for null / empty / malformed input (never Invalid Date)', () => {
    expect(formatDateTime(null, 'Asia/Taipei')).toBe(EM_DASH);
    expect(formatDateTime('', 'Asia/Taipei')).toBe(EM_DASH);
    expect(formatDateTime('not-a-date', 'Asia/Taipei')).toBe(EM_DASH);
    expect(formatDateTime('2026-13-45T99:99:99Z', 'Asia/Taipei')).toBe(EM_DASH);
  });

  it('uses the resolved local zone when no zone is given (production default)', () => {
    // The component calls formatDateTime(iso) with no zone, so the omitted-arg
    // path must resolve to the environment's local TZ — asserted against the
    // same instant formatted with that explicitly-resolved zone (independent of
    // whatever TZ the runner uses; never a bare slice nor 'Invalid Date').
    const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(formatDateTime('2026-07-17T12:34:56Z')).toBe(
      formatDateTime('2026-07-17T12:34:56Z', localZone),
    );
  });
});
