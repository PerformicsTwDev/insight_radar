import { z } from 'zod';
import { api } from './client';
import {
  ANALYSIS_STATUSES,
  ErrorResponseSchema,
  parseJobProgress,
  type ErrorResponse,
  type StatusFetch,
} from './keywordAnalyses';

/**
 * Typed egress for the 購買歷程 (journey) job (T4.4, FR-15; TC-42). Business code
 * calls these — never a bare `fetch` (single-egress, Design §2/§3).
 *
 * **openapi gap (deviation, documented):** the backend `openapi.json` declares
 * **no** request/response body schema for the journey 202 / GET (`content: never`,
 * #392 class), so the codegen'd `paths` give us no shape. We therefore (a) bind the
 * **path** to the generated op (path drift → compile error) and (b) zod-validate the
 * untyped **response** bodies here against the backend contract (backend FR-33):
 * POST 202 → `{ journeyJobId }`, GET → `JourneyStatusResponse`
 * (`{ journeyJobId, status, progress, keywordCount }`). `keywordCount` stays
 * nullable (missing ≠ 0, C12); the opaque `progress` payload is `z.unknown()`. The
 * stage 表 itself is read via `POST /query {view:'journey'}` (view-router, see
 * `api/query.ts`) — journey has no dedicated content endpoint. Never throws — every
 * failure maps to an `ok:false` / `StatusFetch` discriminant.
 */

/** 202 body (not in openapi; per backend FR-33 → `{ journeyJobId }`). */
const StartJourneyResponseSchema = z.object({ journeyJobId: z.string().min(1) });

export type StartJourneyResult =
  | { readonly ok: true; readonly journeyJobId: string }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

/** `GET :id/journey` 回應（最新 run 狀態，供輪詢；backend `JourneyStatusResponse`）。 */
export const JourneyRunSchema = z.object({
  journeyJobId: z.string(),
  status: z.string(),
  progress: z.unknown(),
  keywordCount: z.number().nullable(),
});
export type JourneyRun = z.infer<typeof JourneyRunSchema>;

export type FetchJourneyRunResult =
  { readonly ok: true; readonly run: JourneyRun } | { readonly ok: false; readonly status: number };

/**
 * Start a journey run (enqueue-only). Egress via the typed `api` client (never a
 * bare fetch). On 202 the (openapi-untyped) body is zod-validated to
 * `{ ok:true, journeyJobId }`; on any non-2xx the body is parsed against
 * `ErrorResponse` so callers can surface the snapshot-not-ready hint (undefined
 * when the body is not an `ErrorResponse`). A 202 without a valid `journeyJobId`
 * degrades to `ok:false`. The journey POST carries no request body (backend
 * `create` is enqueue-only).
 */
export async function startJourney(id: string): Promise<StartJourneyResult> {
  const { data, error, response } = await api.POST('/api/v1/keyword-analyses/{id}/journey', {
    params: { path: { id } },
  });

  if (response.ok) {
    const parsed = StartJourneyResponseSchema.safeParse(data);
    if (parsed.success) return { ok: true, journeyJobId: parsed.data.journeyJobId };
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
 * Fetch the latest journey run status. Egress via the typed `api` client (never a
 * bare fetch). On 2xx the (openapi-untyped) body is zod-validated as
 * `JourneyStatusResponse` → `{ ok:true, run }`; a parse failure or any non-2xx
 * degrades to `ok:false`.
 */
export async function fetchJourneyRun(id: string): Promise<FetchJourneyRunResult> {
  const { data, response } = await api.GET('/api/v1/keyword-analyses/{id}/journey', {
    params: { path: { id } },
  });
  if (response.ok) {
    const parsed = JourneyRunSchema.safeParse(data);
    if (parsed.success) return { ok: true, run: parsed.data };
    return { ok: false, status: response.status };
  }
  return { ok: false, status: response.status };
}

/**
 * Journey-scoped DB-status source for `useJobTracking` (T4.4; mirrors
 * `fetchTopicsStatus`, M3-R1). Reads the journey run's **own** `status` from
 * `GET :id/journey` and maps it to the shared {@link StatusFetch}, so the journey
 * job's C3-confirm + poll fallback never settle off the (already-terminal) MAIN
 * analysis's status. 404 → not-found terminal; any other non-2xx, or an
 * unrecognised status string, → `unavailable` (keep polling). The run's live
 * `progress` is FORWARDED (not dropped) so a poll fallback keeps the bar instead of
 * blanking it to 0%/'準備中' (§7; #643).
 */
export async function fetchJourneyStatus(id: string): Promise<StatusFetch> {
  const res = await fetchJourneyRun(id);
  if (!res.ok) {
    return res.status === 404 ? { kind: 'not_found' } : { kind: 'unavailable' };
  }
  const status = ANALYSIS_STATUSES.find((s) => s === res.run.status);
  if (!status) {
    return { kind: 'unavailable' };
  }
  return { kind: 'ok', status: { status, progress: parseJobProgress(res.run.progress) } };
}
