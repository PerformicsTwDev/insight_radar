import { EM_DASH } from './keywordsTable';

/**
 * A backend UTC ISO instant (`…Z`) → `YYYY-MM-DD HH:mm` in the viewer's local
 * timezone (issue #651). `new Date(iso)` parses the `Z` offset into the correct
 * UTC instant, and `Intl.DateTimeFormat` renders it as that instant's local
 * wall-clock — so a TW/UTC+8 analyst who ran an analysis at 20:34 local sees
 * '20:34' (not the bare-sliced UTC '12:34'), with dates near midnight on the
 * right calendar day.
 *
 * The format is assembled from `formatToParts` (fixed `en-CA`, Latin digits,
 * `h23` hour cycle) so it is `YYYY-MM-DD HH:mm` regardless of the runtime
 * locale — only the timezone follows the viewer. `timeZone` defaults to the
 * environment's resolved zone; tests pass it explicitly to stay deterministic.
 *
 * `null` / empty / malformed input → an em-dash fallback, never `Invalid Date`.
 */
export function formatDateTime(iso: string | null, timeZone?: string): string {
  if (iso === null) return EM_DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EM_DASH;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const field: Record<string, string> = {};
  for (const part of parts) field[part.type] = part.value;
  return `${field.year}-${field.month}-${field.day} ${field.hour}:${field.minute}`;
}
