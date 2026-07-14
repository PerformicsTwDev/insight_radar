/**
 * Pure create-analysis form helpers (T1.2, FR-2). **No React / no IO** → core
 * `src/lib/**` (≥90% coverage gate). The React shell (`features/home/HomeRoute`)
 * is a thin container over these; extracting them here is the T1.2 ③ refactor so
 * the same seeds-parse / validity / error-field-mapping logic is reused by the
 * error-state matrix work in T6.1 (Design §3: lib = pure, features = containers).
 */

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

/**
 * Textarea string → seed list: split on newlines/commas, trim each, drop empties.
 * No de-duplication (that is the AI-ideation append concern, T1.5/C7); this is
 * purely raw-input → the `seeds: string[]` the backend DTO expects (≥1 non-empty).
 */
export function parseSeeds(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((seed) => seed.trim())
    .filter((seed) => seed.length > 0);
}

/**
 * Client-side validity gate: seeds valid iff ≥1 non-empty parsed seed; geo /
 * language valid iff non-empty after trim. `isSubmittable` (all three valid)
 * drives the CTA disabled state before any POST (TC-13).
 */
export function checkValidity(input: CreateAnalysisFormInput): FormValidity {
  const fields = {
    seeds: parseSeeds(input.seedsRaw).length >= 1,
    geo: input.geo.trim().length > 0,
    language: input.language.trim().length > 0,
  } as const;
  return { fields, isSubmittable: fields.seeds && fields.geo && fields.language };
}

/**
 * `ErrorResponse.fields` (field → message[]; Design §4) → a clean per-field error
 * record for inline rendering. Entries whose message list is missing/empty are
 * dropped so the caller can treat any present key as "has errors" (TC-13/TC-36).
 */
export function mapFieldErrors(
  fields: Record<string, string[]> | undefined,
): Record<string, string[]> {
  if (!fields) return {};
  const out: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(fields)) {
    if (Array.isArray(messages) && messages.length > 0) out[field] = messages;
  }
  return out;
}
