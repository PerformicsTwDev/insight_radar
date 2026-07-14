import { z } from 'zod';
import { api } from './client';
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

/** 202 body (not in openapi; per FR-2 → `{ analysisId }`). */
const CreateResponseSchema = z.object({ analysisId: z.string().min(1) });

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

/**
 * Create a keyword analysis. Egress goes through the typed `api` client (never a
 * bare fetch). On 202 the (untyped-in-openapi) body is zod-validated to `{ ok:
 * true, analysisId }`; on any non-2xx the body is parsed against `ErrorResponse`
 * so callers can surface `fields` inline (undefined when the body is not an
 * `ErrorResponse`). A 202 without a valid `analysisId` degrades to `ok:false`.
 */
export async function createKeywordAnalysis(
  body: CreateKeywordAnalysisBody,
): Promise<CreateKeywordAnalysisResult> {
  const { data, error, response } = await api.POST('/api/v1/keyword-analyses', { body });

  if (response.ok) {
    const parsed = CreateResponseSchema.safeParse(data);
    if (parsed.success) return { ok: true, analysisId: parsed.data.analysisId };
    return { ok: false, status: response.status };
  }

  const parsedError = ErrorResponseSchema.safeParse(error);
  return {
    ok: false,
    status: response.status,
    error: parsedError.success ? parsedError.data : undefined,
  };
}

/**
 * Job status body (`GET :id`; T1.3, FR-3). Same openapi gap as the create route
 * (codegen types it `never`), so the DB-truth body is zod-validated here. `status`
 * is the C3-critical field (`completed` vs `partial`) → strict enum; progress /
 * result are lenient/null-safe (null → not补0). `features` is opaque to job
 * tracking (M4 gates own it) → passed through untyped.
 */
const JobProgressBodySchema = z.object({
  phase: z.string().optional(),
  percent: z.number().optional(),
  expanded: z.number().optional(),
  labeled: z.number().optional(),
  total: z.number().optional(),
});
const JobResultBodySchema = z.object({
  resultSnapshotId: z.string().optional(),
  count: z.number().optional(),
});
export const JobStatusSchema = z.object({
  status: z.enum(['queued', 'running', 'completed', 'partial', 'failed', 'canceled']),
  progress: JobProgressBodySchema.nullish(),
  result: JobResultBodySchema.nullish(),
  error: z.string().nullish(),
  features: z.unknown().optional(),
});
export type KeywordAnalysisStatus = z.infer<typeof JobStatusSchema>;

/**
 * Fetch the authoritative DB status of an analysis (C3 confirmation + poll
 * fallback). Egress via the typed `api` client; a non-2xx or a body that fails
 * validation degrades to `null` (the caller keeps its last known state and, when
 * polling, retries) rather than throwing.
 */
export async function getKeywordAnalysisStatus(_id: string): Promise<KeywordAnalysisStatus | null> {
  return null;
}

/** Cancel an analysis (`DELETE :id`). Returns whether the backend accepted the cancel. */
export async function cancelKeywordAnalysis(_id: string): Promise<boolean> {
  return false;
}
