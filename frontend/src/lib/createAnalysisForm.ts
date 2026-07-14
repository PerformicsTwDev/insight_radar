/**
 * Pure create-analysis form helpers (T1.2, FR-2). **No React / no IO** → core
 * `src/lib/**` (≥90% coverage gate). The React shell (`features/home/HomeRoute`)
 * is a thin container over these; extracting them here is the T1.2 ③ refactor so
 * the same seeds-parse / validity / error-field-mapping logic is reused by the
 * error-state matrix work in T6.1 (Design §3: lib = pure, features = containers).
 */

// RED stub (T1.2) — typed not-implemented shell; real impl lands in the green commit.

/** The three required create-analysis fields the CTA gate depends on. */
export type CreateAnalysisField = 'seeds' | 'geo' | 'language';

export interface CreateAnalysisFormInput {
  /** Raw seeds textarea contents (newline/comma separated). */
  readonly seedsRaw: string;
  readonly geo: string;
  readonly language: string;
}

export interface FormValidity {
  /** Per-field validity — `true` = valid (non-empty after normalisation). */
  readonly fields: Readonly<Record<CreateAnalysisField, boolean>>;
  /** All required fields valid → the CTA may fire a POST. */
  readonly isSubmittable: boolean;
}

/** Textarea string → seed list: split on newlines/commas, trim, drop empties. */
export function parseSeeds(_raw: string): string[] {
  return [];
}

/** Client-side validity: which required fields are valid + whether the form may submit. */
export function checkValidity(_input: CreateAnalysisFormInput): FormValidity {
  return { fields: { seeds: false, geo: false, language: false }, isSubmittable: false };
}

/** `ErrorResponse.fields` (field → message[]) → clean per-field error record. */
export function mapFieldErrors(
  _fields: Record<string, string[]> | undefined,
): Record<string, string[]> {
  return {};
}
