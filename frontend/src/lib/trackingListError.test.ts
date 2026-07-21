import { describe, expect, it } from 'vitest';
import { trackingListErrorMessage } from './trackingListError';

/**
 * TC-40 (unit, core; FR-19 · backend FR-28) — the shared tracking-list error classifier
 * (the inline error convention T6.1 later hoists into a toast/banner). Each failure code
 * maps to its OWN readable prompt (never one generic sentence): geo/language mismatch
 * (400), a duplicate name vs a size cap (both 409, disambiguated by the backend
 * `ErrorResponse.message` since `code` is `CONFLICT` for both), and a gone/not-owned
 * target (404). Any other status degrades to a generic retry prompt.
 */

describe('TC-40: trackingListErrorMessage', () => {
  it('maps a 400 to a geo/language context-mismatch prompt', () => {
    expect(trackingListErrorMessage(400)).toContain('地區');
    expect(trackingListErrorMessage(400)).toContain('語言');
  });

  it('maps a 404 to a not-found / no-access prompt', () => {
    expect(trackingListErrorMessage(404)).toContain('找不到');
  });

  it('maps a 409 whose message says the list limit was reached to a cap prompt', () => {
    expect(trackingListErrorMessage(409, 'Tracking list limit reached (max 20)')).toContain('上限');
  });

  it('maps a 409 whose message says the member limit was reached to a cap prompt', () => {
    expect(trackingListErrorMessage(409, 'Tracking list member limit reached (max 500)')).toContain(
      '上限',
    );
  });

  it('maps a 409 duplicate-name message to a name-collision prompt', () => {
    expect(trackingListErrorMessage(409, 'Tracking list "Trail" already exists')).toContain('名稱');
  });

  it('treats a 409 with no message as a name collision (the default 409 in create/rename)', () => {
    expect(trackingListErrorMessage(409)).toContain('名稱');
  });

  it('maps any other status to a generic retry prompt', () => {
    expect(trackingListErrorMessage(500)).toContain('稍後');
  });

  it('gives each error code its OWN distinct prompt (not one generic sentence)', () => {
    const geoLang = trackingListErrorMessage(400);
    const notFound = trackingListErrorMessage(404);
    const cap = trackingListErrorMessage(409, 'Tracking list limit reached (max 20)');
    const nameDup = trackingListErrorMessage(409, 'Tracking list "x" already exists');
    const generic = trackingListErrorMessage(500);
    const all = [geoLang, notFound, cap, nameDup, generic];
    expect(new Set(all).size).toBe(all.length);
  });
});
