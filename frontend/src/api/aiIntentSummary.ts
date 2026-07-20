import createClient from 'openapi-fetch';
import { z } from 'zod';
import { config } from '../config/env';
import { createAuthMiddleware } from './authInterceptor';
import { authProvider } from './client';
import type { AiCellErrorKind } from '../lib/aiCellState';

/**
 * Typed egress for the single-cell ✦ AI-intent summary (T4.1, FR-18; TC-28 /
 * AC-18.1). Business code calls this — never a bare `fetch` (single-egress,
 * Design §2/§3).
 *
 * **openapi gap (deviation, documented):** the real endpoint is backend FR-31
 * (`POST :id/ai-intent-summary`), which is **SERP-grounded and deferred to after
 * M14** — so it is **not yet in the generated openapi**. Mirroring the
 * `aiIdeation.ts` stage, this uses a small hand-written path type + a dedicated
 * openapi-fetch client that shares the app base URL / `credentials` / fetch-deferral
 * (so MSW intercepts in tests) and **auth middleware**. When the backend ships,
 * the generated `paths` supersede {@link AiIntentSummaryStubPaths} and this
 * collapses into the shared `api` client. The 200 body is runtime-zod-validated
 * (honest parse, not a cast).
 *
 * FR-31 deferral (documented): the SERP gate (`409 serp_not_captured` →
 * "需先擷取搜尋結果") is **not** wired here yet — that column feature-flags on with
 * the backend. A 409 therefore maps to the generic `unavailable` kind for now;
 * T4.1 is the generic state machine + gate decoupling, tested via a mock endpoint.
 */

/** Local placeholder openapi path for the not-yet-generated ai-intent-summary op. */
interface AiIntentSummaryStubPaths {
  '/api/v1/keyword-analyses/{id}/ai-intent-summary': {
    post: {
      parameters: { query?: never; header?: never; path: { id: string }; cookie?: never };
      requestBody: {
        content: {
          'application/json': { scope: 'keyword'; normalizedText?: string };
        };
      };
      responses: {
        200: { content: { 'application/json': { normalizedText: string; summary: string } } };
      };
    };
  };
}

const summaryClient = createClient<AiIntentSummaryStubPaths>({
  baseUrl: config.apiBaseUrl || window.location.origin,
  credentials: 'include',
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});
summaryClient.use(createAuthMiddleware(authProvider));

/** 200 body (backend AC-31.2 → `{ normalizedText, summary }`). */
const SummarySchema = z.object({ normalizedText: z.string(), summary: z.string() });

export type AiIntentSummaryResult =
  | { readonly ok: true; readonly summary: string }
  | { readonly ok: false; readonly status: number; readonly kind: AiCellErrorKind };

/**
 * Summarise one keyword's search intent (`scope:'keyword'`). On 200 the (stub)
 * body is zod-validated to `{ normalizedText, summary }`; a **400** (scope
 * keyword with no/blank `normalizedText`, AC-31.2) maps to the `invalid` kind so
 * the cell can surface a distinct "缺少關鍵字資料" mark; any other non-2xx or an
 * invalid body degrades to `unavailable` (retryable). Never throws.
 */
export async function summarizeKeywordIntent(
  id: string,
  normalizedText: string | undefined,
): Promise<AiIntentSummaryResult> {
  const { data, response } = await summaryClient.POST(
    '/api/v1/keyword-analyses/{id}/ai-intent-summary',
    { params: { path: { id } }, body: { scope: 'keyword', normalizedText } },
  );

  if (response.ok) {
    const parsed = SummarySchema.safeParse(data);
    if (parsed.success) return { ok: true, summary: parsed.data.summary };
    return { ok: false, status: response.status, kind: 'unavailable' };
  }

  // 400 = scope:'keyword' with no/blank normalizedText (AC-31.2) → a request-shape
  // error a retry can't fix; any other non-2xx (incl. the deferred FR-31 409 serp
  // gate) is a generic, retryable failure.
  return {
    ok: false,
    status: response.status,
    kind: response.status === 400 ? 'invalid' : 'unavailable',
  };
}
