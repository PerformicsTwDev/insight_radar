import { z } from 'zod';
import { api } from './client';
import { ANALYSIS_STATUSES, type StatusFetch } from './keywordAnalyses';

/**
 * Typed egress for the 自訂分類 **stage-two** assignment job (T5.2, FR-16; backend
 * FR-34 / AC-34.2; TC-42). Business code calls these — never a bare `fetch`
 * (single-egress, Design §2/§3).
 *
 * **openapi gap (deviation, documented):** the backend `openapi.json` types the
 * assignment `CustomClassifyAssignDto` request as `Record<string, never>` and every
 * response body as `never` (#392 class), so the codegen'd `paths` give us no shape.
 * We therefore (a) bind the **path** to the generated op (path drift → compile error),
 * (b) send the real `{ labels:[{label,description}] }` body cast-free via a
 * `bodySerializer` (openapi-fetch calls it whenever `body` is not `undefined`), and
 * (c) zod-validate the untyped response bodies here against the backend contract:
 * POST 202 → `{ jobId }`, `GET .../assignments` → `{ jobId, status, progress,
 * keywordCount }`. `keywordCount` stays nullable (missing ≠ 0, C12). The 分類表 itself
 * is read via `POST /query {view:'custom:{cid}'}` (view-router, `api/query.ts`) —
 * custom has no dedicated content endpoint. Never throws — every failure maps to an
 * `ok:false` / `StatusFetch` discriminant.
 */

/** 202 body (not in openapi; per backend FR-34 → `{ jobId }` = the run id / SSE key). */
const StartAssignResponseSchema = z.object({ jobId: z.string().min(1) });

/** `GET .../assignments` 回應（最新 run 狀態，供輪詢；backend `CustomClassifyStatusResponse`）。 */
export const CustomClassifyRunSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  progress: z.unknown(),
  keywordCount: z.number().nullable(),
});
export type CustomClassifyRun = z.infer<typeof CustomClassifyRunSchema>;

export type StartCustomClassifyAssignResult =
  { readonly ok: true; readonly jobId: string } | { readonly ok: false; readonly status: number };

export type FetchCustomClassifyRunResult =
  | { readonly ok: true; readonly run: CustomClassifyRun }
  | { readonly ok: false; readonly status: number };

export type RemoveCustomClassificationResult =
  { readonly ok: true } | { readonly ok: false; readonly status: number };

/**
 * Enqueue the整批歸類 run for the HITL-confirmed `labels` (enqueue-only). The modal
 * seam carries label **strings** (accumulated / manual chips have no description), so
 * the DTO's `{ label, description }` shape is rebuilt here with an empty description.
 * On 202 the (openapi-untyped) body is zod-validated to `{ ok:true, jobId }`; a 404
 * (unknown/not owner), 409 (empty labels / in-progress run), 413 (over the cost
 * guard), or a 202 without a valid `jobId` all degrade to `ok:false` with the status.
 */
export async function startCustomClassifyAssign(
  id: string,
  cid: string,
  labels: readonly string[],
): Promise<StartCustomClassifyAssignResult> {
  const { data, response } = await api.POST(
    '/api/v1/keyword-analyses/{id}/custom-classifications/{cid}/assignments',
    {
      params: { path: { id, cid } },
      // `CustomClassifyAssignDto` is under-typed `Record<string, never>`; the serializer
      // sends the real `{ labels:[{label,description}] }` body cast-free.
      body: {},
      bodySerializer: () =>
        JSON.stringify({ labels: labels.map((label) => ({ label, description: '' })) }),
    },
  );

  if (response.ok) {
    const parsed = StartAssignResponseSchema.safeParse(data);
    if (parsed.success) return { ok: true, jobId: parsed.data.jobId };
    return { ok: false, status: response.status };
  }
  return { ok: false, status: response.status };
}

/**
 * Fetch the latest assignment-run status. On 2xx the (openapi-untyped) body is
 * zod-validated as the run projection → `{ ok:true, run }`; a parse failure or any
 * non-2xx degrades to `ok:false`.
 */
export async function fetchCustomClassifyRun(
  id: string,
  cid: string,
): Promise<FetchCustomClassifyRunResult> {
  const { data, response } = await api.GET(
    '/api/v1/keyword-analyses/{id}/custom-classifications/{cid}/assignments',
    { params: { path: { id, cid } } },
  );
  if (response.ok) {
    const parsed = CustomClassifyRunSchema.safeParse(data);
    if (parsed.success) return { ok: true, run: parsed.data };
    return { ok: false, status: response.status };
  }
  return { ok: false, status: response.status };
}

/**
 * Assignment-scoped DB-status source for `useJobTracking` (mirrors `fetchJourneyStatus`,
 * M3-R1). Reads the run's **own** `status` from `GET .../assignments` and maps it to
 * the shared {@link StatusFetch}, so the classify job's C3-confirm + poll fallback never
 * settle off the (already-terminal) MAIN analysis. 404 (no run) → not-found terminal;
 * any other non-2xx, or an unrecognised status string, → `unavailable` (keep polling).
 */
export async function fetchCustomClassifyAssignStatus(
  id: string,
  cid: string,
): Promise<StatusFetch> {
  const res = await fetchCustomClassifyRun(id, cid);
  if (!res.ok) {
    return res.status === 404 ? { kind: 'not_found' } : { kind: 'unavailable' };
  }
  const status = ANALYSIS_STATUSES.find((s) => s === res.run.status);
  return status ? { kind: 'ok', status: { status } } : { kind: 'unavailable' };
}

/**
 * Delete a custom classification (`DELETE .../custom-classifications/{cid}`) — drops the
 * classification and its dynamic `custom:{cid}` view. 200 → `ok:true`; any non-2xx (404
 * unknown/not owner, etc.) → `ok:false` with the status. Never throws.
 */
export async function removeCustomClassification(
  id: string,
  cid: string,
): Promise<RemoveCustomClassificationResult> {
  const { response } = await api.DELETE(
    '/api/v1/keyword-analyses/{id}/custom-classifications/{cid}',
    { params: { path: { id, cid } } },
  );
  return response.ok ? { ok: true } : { ok: false, status: response.status };
}
