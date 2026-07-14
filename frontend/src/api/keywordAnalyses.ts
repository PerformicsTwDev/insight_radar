import { z } from 'zod';
import type { components } from './schema';

/**
 * Typed egress wrapper for `POST /api/v1/keyword-analyses` (T1.2, FR-2). Business
 * code calls this — never a bare `fetch` (single-egress, Design §2/§3).
 *
 * **openapi gap (deviation, documented):** the backend `openapi.json` describes
 * the 202 (and 4xx) with *no* response body schema, so the codegen'd `paths`
 * type the bodies as `never`. openapi-fetch still parses the JSON body at runtime
 * (into `data` for 2xx / `error` for non-2xx). We therefore validate those
 * untyped bodies here with zod (honest runtime parse, not a bare cast) against
 * the contract documented in backend Design §4 (`ErrorResponse`) / FR-2
 * (202 → `{ analysisId }`). The **request** body stays bound to the generated
 * `CreateKeywordAnalysisDto`, so request-shape drift is still a compile error.
 */

/** Request body — bound to the generated openapi DTO (drift → compile error). */
export type CreateKeywordAnalysisBody = components['schemas']['CreateKeywordAnalysisDto'];

/** `ErrorResponse` shape (Design §4; not in openapi — the codegen has no error schema). */
export const ErrorResponseSchema = z.object({
  statusCode: z.number(),
  code: z.string().optional(),
  message: z.union([z.string(), z.array(z.string())]).optional(),
  fields: z.record(z.string(), z.array(z.string())).optional(),
  path: z.string().optional(),
  timestamp: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export type CreateKeywordAnalysisResult =
  | { readonly ok: true; readonly analysisId: string }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

// RED stub (T1.2) — typed not-implemented shell; real impl (typed `api` egress + zod parse) in green.
export function createKeywordAnalysis(
  _body: CreateKeywordAnalysisBody,
): Promise<CreateKeywordAnalysisResult> {
  return Promise.resolve({ ok: false, status: 0 });
}
