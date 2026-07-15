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
 * Result of fetching the authoritative DB status (`GET :id`). A **404 is
 * `not_found`** — permanent (deleted / expired / owner-filtered shared link) →
 * the caller settles into the not-found terminal and stops polling (FR-3
 * boundary). Any other non-2xx or a schema-invalid body is `unavailable` —
 * treated as transient, so the poll keeps retrying toward recovery. The 404 vs
 * other-error split is exactly what prevents the UI freezing on a gone id.
 */
export type StatusFetch =
  | { readonly kind: 'ok'; readonly status: KeywordAnalysisStatus }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unavailable' };

/**
 * Fetch the authoritative DB status of an analysis (C3 confirmation + poll
 * fallback). Egress via the typed `api` client; never throws — every failure is
 * mapped to a {@link StatusFetch} discriminant so the caller can distinguish a
 * permanent not-found from a transient error.
 */
export async function getKeywordAnalysisStatus(id: string): Promise<StatusFetch> {
  const { data, response } = await api.GET('/api/v1/keyword-analyses/{id}', {
    params: { path: { id } },
  });
  // 404 is permanent (deleted / expired / owner-filtered) → not-found terminal; every
  // other non-2xx (or invalid body) is transient → keep polling toward recovery.
  if (response.status === 404) return { kind: 'not_found' };
  if (!response.ok) return { kind: 'unavailable' };
  const parsed = JobStatusSchema.safeParse(data);
  return parsed.success ? { kind: 'ok', status: parsed.data } : { kind: 'unavailable' };
}

/** Cancel an analysis (`DELETE :id`). Returns whether the backend accepted the cancel. */
export async function cancelKeywordAnalysis(id: string): Promise<boolean> {
  const { response } = await api.DELETE('/api/v1/keyword-analyses/{id}', {
    params: { path: { id } },
  });
  return response.ok;
}

/** Analysis lifecycle status (backend `AnalysisStatus`) — the closed set the history filter allows. */
export const ANALYSIS_STATUSES = [
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'canceled',
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/**
 * One analysis-history row (backend `AnalysisListRow`, T9.6/FR-23). Dates are ISO
 * strings over the wire; `finishedAt` / `count` stay nullable (a not-yet-finished
 * or countless run → `—`, never 0 — C12).
 */
const AnalysisListRowSchema = z.object({
  analysisId: z.string(),
  status: z.enum(ANALYSIS_STATUSES),
  seeds: z.array(z.string()),
  params: z.object({
    mode: z.string().optional(),
    geo: z.string().optional(),
    language: z.string().optional(),
  }),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  resultSnapshotId: z.string().nullable(),
  count: z.number().nullable(),
});
export type AnalysisListRow = z.infer<typeof AnalysisListRowSchema>;

/** `GET /keyword-analyses` envelope (backend `AnalysesListResponse`). */
const AnalysesListResponseSchema = z.object({
  data: z.array(AnalysisListRowSchema),
  meta: z.object({ total: z.number(), page: z.number(), pageSize: z.number() }),
});
export type AnalysesListMeta = z.infer<typeof AnalysesListResponseSchema>['meta'];

export interface ListAnalysesParams {
  readonly page?: number;
  readonly pageSize?: number;
  readonly status?: AnalysisStatus;
}
export type ListAnalysesResult =
  | {
      readonly ok: true;
      readonly data: readonly AnalysisListRow[];
      readonly meta: AnalysesListMeta;
    }
  | { readonly ok: false; readonly status: number };

/**
 * List analysis history (`GET /keyword-analyses`; T3.5, FR-10 / AC-10.1). The
 * query params (page/pageSize/status) are bound to the generated op (request
 * drift → compile error); the 200 body is openapi-untyped (#392) so it is
 * zod-validated here against the backend `AnalysesListResponse` (`{ data, meta }`).
 * Never throws — any non-2xx or a schema-invalid body maps to `ok:false`.
 */
export async function listKeywordAnalyses(
  params: ListAnalysesParams = {},
): Promise<ListAnalysesResult> {
  throw new Error(`not implemented (${params.status ?? 'all'})`); // red — green in the next commit
}
