import { z } from 'zod';

/**
 * Feature-gate status model (T3.2, FR-9). Pure `core` lib — no React / no IO — so
 * the defensive extraction is exhaustively unit-testable (≥90% core gate). The
 * reusable overlay component (`components/FeatureGate`) renders the four states;
 * containers (T3.3 topics / T4.4 journey / T5.2 custom) read the status from a
 * `GET :id` `features` map via {@link featureStatusOf} and hand it to the overlay.
 */

/**
 * A dashboard feature's compute status (backend `FeatureStatus`, AC-14.7):
 * `not_generated` (gate → CTA), `running` (progress), `ready` (content), `failed`
 * (retry).
 */
export const FEATURE_STATUSES = ['not_generated', 'running', 'ready', 'failed'] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

/** One feature entry in the `GET :id` features map (backend `{ status }`). */
const FeatureEntrySchema = z.object({ status: z.enum(FEATURE_STATUSES) });

/**
 * Defensively extract a feature's status from the opaque `GET :id` `features` map
 * (the job-status parse types it `unknown` — job tracking doesn't decode it, M4
 * gates own it). An absent key / non-object map / malformed entry / unknown status
 * value all resolve to `not_generated` (a gate that has not run) rather than
 * throwing — a missing gate is "not generated", never a crash.
 */
export function featureStatusOf(features: unknown, key: string): FeatureStatus {
  if (typeof features !== 'object' || features === null) {
    return 'not_generated';
  }
  const entry = (features as Record<string, unknown>)[key];
  const parsed = FeatureEntrySchema.safeParse(entry);
  return parsed.success ? parsed.data.status : 'not_generated';
}
