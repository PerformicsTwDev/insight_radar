import type { FilterSpec } from '../lib/filterSpec';

/**
 * Typed egress for `POST /api/v1/keyword-analyses/:id/ai-insight` (T4.3, FR-17;
 * TC-42). Per-view AI 洞察: given a view + the currently-applied filters, the
 * backend (FR-32) summarises that view's *aggregated* result and returns
 * `{ view, insight, generatedAt }`. Business code calls this — never a bare
 * `fetch` (single-egress, Design §2/§3).
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
 * Generate the per-view AI insight. **C4**: the filters cross the wire in the ONE
 * canonical form (`canonicalFilters`) so the backend filters-hash matches `/query`
 * + the shareable URL. Never throws — a 502 (AI_INSIGHT_GENERATION_FAILED), 409
 * (feature not ready), or an invalid 200 body all degrade to `ok:false` so the UI
 * shows a clean error, never a half summary.
 */
export async function generateAiInsight(
  _id: string,
  _view: string,
  _filters: FilterSpec,
): Promise<AiInsightResult> {
  // SHELL (red): not implemented.
  return { ok: false, status: 0 };
}
