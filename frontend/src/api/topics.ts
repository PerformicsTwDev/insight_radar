import { z } from 'zod';
import { api } from './client';
import { ErrorResponseSchema, type ErrorResponse } from './keywordAnalyses';

/**
 * Typed egress for the intent-topics job (T3.3, FR-8; TC-41). Business code calls
 * these — never a bare `fetch` (single-egress, Design §2/§3).
 *
 * **openapi gap (deviation, documented):** the backend `openapi.json` types the
 * topics request `CreateTopicRunDto` as `Record<string, never>` (empty) and
 * declares **no** response body schema for the 202 / GET (`content: never`, #392
 * class). So we (a) bind the **path** to the generated op (path drift → compile
 * error) and send the real optional body cast-free via a request-level
 * `bodySerializer` (openapi-fetch calls it whenever `body` is not `undefined`;
 * `body: {}` satisfies the `Record<string, never>` type), and (b) zod-validate the
 * untyped **response** bodies here against the backend contract (backend FR-15/18):
 * POST 202 → `{ topicJobId }`, GET → `TopicsResponse`. Nullable fields
 * (`clusterVolume` / `confidence` / `reason`) stay nullable (missing ≠ 0, C12);
 * opaque payloads (`progress` / `representativeKeywords`) are `z.unknown()`. Never
 * throws — every failure maps to an `ok:false` discriminant.
 */

/** POST body (backend `CreateTopicRunDto`; all fields optional). */
export interface StartTopicsBody {
  readonly serpEnabled?: boolean;
  readonly topK?: number;
  readonly umap?: Record<string, unknown>;
  readonly hdbscan?: Record<string, unknown>;
}

/** 202 body (not in openapi; per backend FR-15 → `{ topicJobId }`). */
const StartTopicsResponseSchema = z.object({ topicJobId: z.string().min(1) });

export type StartTopicsResult =
  | { readonly ok: true; readonly topicJobId: string }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

/** One topic cluster (backend `TopicsResponse.clusters[]`). Nullable metrics stay null (C12). */
const TopicClusterSchema = z.object({
  topicName: z.string(),
  parentTopic: z.string(),
  intentLabel: z.string(),
  topicType: z.string(),
  reason: z.string().nullable(),
  clusterVolume: z.number().nullable(),
  keywordCount: z.number(),
  confidence: z.number().nullable(),
  representativeKeywords: z.unknown(),
});

/** One classified keyword (backend `TopicsResponse.keywords[]`). */
const TopicKeywordSchema = z.object({
  text: z.string(),
  normalizedText: z.string(),
  topicName: z.string().nullable(),
  parentTopic: z.string().nullable(),
  intentLabel: z.string().nullable(),
  confidence: z.number(),
  isNoise: z.boolean(),
});

/** Run metadata (backend `TopicsResponse.meta`). */
const TopicsMetaSchema = z.object({
  runId: z.string(),
  snapshotId: z.string(),
  clusterCount: z.number().nullable(),
  noiseCount: z.number().nullable(),
});

/** `GET :id/topics` envelope (backend `TopicsResponse`). */
export const TopicsResponseSchema = z.object({
  status: z.string(),
  progress: z.unknown(),
  clusters: z.array(TopicClusterSchema),
  keywords: z.array(TopicKeywordSchema),
  meta: TopicsMetaSchema,
});
export type TopicsResponse = z.infer<typeof TopicsResponseSchema>;
export type TopicCluster = z.infer<typeof TopicClusterSchema>;
export type TopicKeyword = z.infer<typeof TopicKeywordSchema>;

export type FetchTopicsResult =
  | { readonly ok: true; readonly topics: TopicsResponse }
  | { readonly ok: false; readonly status: number };

/**
 * Start a topics run. Egress via the typed `api` client (never a bare fetch). On
 * 202 the (openapi-untyped) body is zod-validated to `{ ok:true, topicJobId }`; on
 * any non-2xx the body is parsed against `ErrorResponse` so callers can surface the
 * snapshot-not-ready hint (undefined when the body is not an `ErrorResponse`). A
 * 202 without a valid `topicJobId` degrades to `ok:false`.
 */
export async function startTopics(id: string, body?: StartTopicsBody): Promise<StartTopicsResult> {
  const { data, error, response } = await api.POST('/api/v1/keyword-analyses/{id}/topics', {
    params: { path: { id } },
    // Body is under-documented in openapi (typed `Record<string, never>`); send the
    // real (optional) payload cast-free via the serializer, which openapi-fetch calls
    // whenever `body` is not undefined (`{}` satisfies the empty-record type).
    body: {},
    bodySerializer: () => JSON.stringify(body ?? {}),
  });

  if (response.ok) {
    const parsed = StartTopicsResponseSchema.safeParse(data);
    if (parsed.success) return { ok: true, topicJobId: parsed.data.topicJobId };
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
 * Fetch the topics result. Egress via the typed `api` client (never a bare fetch).
 * On 2xx the (openapi-untyped) body is zod-validated as `TopicsResponse` →
 * `{ ok:true, topics }`; a parse failure or any non-2xx degrades to `ok:false`.
 */
export async function fetchTopics(id: string): Promise<FetchTopicsResult> {
  const { data, response } = await api.GET('/api/v1/keyword-analyses/{id}/topics', {
    params: { path: { id } },
  });
  if (response.ok) {
    const parsed = TopicsResponseSchema.safeParse(data);
    if (parsed.success) return { ok: true, topics: parsed.data };
    return { ok: false, status: response.status };
  }
  return { ok: false, status: response.status };
}
