import { z } from 'zod';
import { api } from './client';
import { ErrorResponseSchema, type ErrorResponse } from './keywordAnalyses';
import type { components } from './schema';

/**
 * Typed egress for `POST /api/v1/ai-search-analyses` (T8.1, FR-23/FR-24; backend
 * FR-41). Enqueue-only (INV-3, same async shape as keyword-analyses): the request
 * body is bound to the generated `CreateAiSearchAnalysisDto` (channel-enum drift →
 * compile error). Business code calls this — never a bare `fetch` (Design §2/§3).
 *
 * **openapi gap (deviation, documented):** the 202 (and 4xx) body is openapi-untyped
 * (#392) → zod-validated here to `{ jobId }` (FR-41) / `ErrorResponse` (Design §4).
 */

export type CreateAiSearchAnalysisBody = components['schemas']['CreateAiSearchAnalysisDto'];

/** 202 body (not in openapi; per FR-41 → `{ jobId }`). */
const CreateAiSearchResponseSchema = z.object({ jobId: z.string().min(1) });

export type CreateAiSearchResult =
  | { readonly ok: true; readonly jobId: string }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

/**
 * Trigger an AI-search capture job. On 202 the (untyped) body is zod-validated to
 * `{ ok: true, jobId }`; on any non-2xx the body is parsed against `ErrorResponse`
 * so the caller can surface `fields` inline. A 202 without a valid `jobId` degrades
 * to `ok:false`.
 */
export async function createAiSearchAnalysis(
  body: CreateAiSearchAnalysisBody,
): Promise<CreateAiSearchResult> {
  const { data, error, response } = await api.POST('/api/v1/ai-search-analyses', { body });

  if (response.ok) {
    const parsed = CreateAiSearchResponseSchema.safeParse(data);
    return parsed.success
      ? { ok: true, jobId: parsed.data.jobId }
      : { ok: false, status: response.status };
  }

  const parsedError = ErrorResponseSchema.safeParse(error);
  return {
    ok: false,
    status: response.status,
    error: parsedError.success ? parsedError.data : undefined,
  };
}
