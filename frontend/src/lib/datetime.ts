import { EM_DASH } from './keywordsTable';

/**
 * Backend UTC ISO instant (`…Z`) → `YYYY-MM-DD HH:mm` for display (issue #651).
 *
 * ⚠ red-first shell: this reproduces the bug being fixed — the ISO is
 * string-sliced, so a UTC instant is shown as a bare wall-clock with no
 * timezone conversion (a TW/UTC+8 analyst who ran an analysis at 20:34 local
 * sees '12:34', and dates near midnight land on the wrong calendar day). The
 * `timeZone` arg is accepted but ignored here; the green commit replaces this
 * body with an `Intl.DateTimeFormat` conversion to the target/local zone.
 */
export function formatDateTime(iso: string | null, timeZone?: string): string {
  void timeZone;
  return iso === null ? EM_DASH : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}
