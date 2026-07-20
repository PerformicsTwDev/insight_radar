import { z } from 'zod';
import { api } from './client';
import { canonicalFilters, type FilterSpec } from '../lib/filterSpec';

/**
 * Typed egress for `POST /api/v1/keyword-analyses/:id/ai-insight` (T4.3, FR-17;
 * TC-42). Per-view AI 洞察: given a view + the currently-applied filters, the
 * backend (FR-32) summarises that view's *aggregated* result and returns
 * `{ view, insight, generatedAt }`. Business code calls this — never a bare
 * `fetch` (single-egress, Design §2/§3).
 *
 * **openapi gap (deviation, documented):** the request DTO is generated
 * (`AiInsightDto` = `{ view, filters }`) but `FilterSpecDto` is typed
 * `Record<string, never>` and the 200 response body is `never` (#392 class). So we
 * bind the **path** to the generated op (path drift → compile error), send the real
 * `{ view, filters }` body cast-free via a `bodySerializer` (openapi-fetch calls it
 * whenever `body` is not `undefined`), and zod-validate the untyped response here.
 */

/** 200 (ok) → the insight; any non-2xx (502 LLM failure / 409 not-ready / 4xx) → status only. */
export type AiInsightResult =
  | {
      readonly ok: true;
      readonly insight: string;
      readonly view: string;
      readonly generatedAt: string;
    }
  | { readonly ok: false; readonly status: number };

/**
 * 200 body (backend FR-32 → `{ view, insight, generatedAt }`). `insight` is
 * `.min(1)`: an empty summary is a half/absent result and must degrade to `ok:false`
 * (the UI never shows a half summary, FR-17).
 */
const AiInsightSchema = z.object({
  view: z.string(),
  insight: z.string().min(1),
  generatedAt: z.string(),
});

/**
 * Generate the per-view AI insight. **C4**: the filters cross the wire in the ONE
 * canonical form (`canonicalFilters`, the same `normalizeSpec` behind `/query` + the
 * shareable URL) so the backend filters-hash matches; an empty spec omits `filters`
 * entirely (the `/query` minimal-body convention). Never throws — a 502
 * (AI_INSIGHT_GENERATION_FAILED), 409 (feature not ready), or an invalid 200 body
 * all degrade to `ok:false` so the UI shows a clean error, never a half summary.
 */
export async function generateAiInsight(
  id: string,
  view: string,
  filters: FilterSpec,
): Promise<AiInsightResult> {
  const canonical = canonicalFilters(filters);
  const request = Object.keys(canonical).length > 0 ? { view, filters: canonical } : { view };

  const { data, response } = await api.POST('/api/v1/keyword-analyses/{id}/ai-insight', {
    params: { path: { id } },
    // `view` satisfies the typed `AiInsightDto`; the serializer sends the real
    // `{ view, filters }` cast-free (filters is under-typed `Record<string,never>`).
    body: { view },
    bodySerializer: () => JSON.stringify(request),
  });

  if (response.ok) {
    const parsed = AiInsightSchema.safeParse(data);
    if (parsed.success) {
      return {
        ok: true,
        insight: parsed.data.insight,
        view: parsed.data.view,
        generatedAt: parsed.data.generatedAt,
      };
    }
    return { ok: false, status: response.status };
  }

  return { ok: false, status: response.status };
}
