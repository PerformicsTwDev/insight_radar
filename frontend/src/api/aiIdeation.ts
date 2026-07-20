import { z } from 'zod';
import { api } from './client';

/**
 * Typed AI-ideation egress (T1.5→T5.3, FR-20; TC-31 / TC-42). Backend FR-35 (M12)
 * is now in the generated openapi, so this binds the **shared `api` client**'s
 * generated op `POST /api/v1/ai-ideation` (`IdeationController_generate`) — a path
 * drift → compile error. Business code calls this — never a bare `fetch`
 * (single-egress, Design §2/§3).
 *
 * **openapi gap (deviation, documented):** the generated request DTO is
 * `IdeationDto = Record<string, never>` and the 200 body is `content?: never`
 * (#392 class). So — mirroring `aiInsight` (T4.3) / `customClassifications` (T5.1)
 * — we bind the **path** to the generated op, send the real `{ template, seeds }`
 * body cast-free via a `bodySerializer` (openapi-fetch calls it whenever `body` is
 * not `undefined`), and zod-validate the untyped 200 response here (honest parse,
 * not a cast).
 */

export interface AiIdeationRequest {
  readonly template: string;
  readonly seeds: string[];
}

export type AiIdeationResult =
  | { readonly ok: true; readonly keywords: string[] }
  | { readonly ok: false; readonly status: number };

const KeywordsSchema = z.object({ keywords: z.array(z.string()) });

/**
 * Generate keyword ideas for `{ template, seeds }`. On 200 the (untyped) body is
 * validated to `{ keywords }`; a non-2xx (400 = unknown template / empty seeds) or
 * an invalid body degrades to `ok:false` (the card surfaces a generic error).
 */
export async function generateIdeas(body: AiIdeationRequest): Promise<AiIdeationResult> {
  const { data, response } = await api.POST('/api/v1/ai-ideation', {
    // `IdeationDto` is under-typed `Record<string, never>`; the serializer sends
    // the real `{ template, seeds }` cast-free.
    body: {},
    bodySerializer: () => JSON.stringify({ template: body.template, seeds: body.seeds }),
  });
  if (!response.ok) return { ok: false, status: response.status };
  const parsed = KeywordsSchema.safeParse(data);
  return parsed.success
    ? { ok: true, keywords: parsed.data.keywords }
    : { ok: false, status: response.status };
}
