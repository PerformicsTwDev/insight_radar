import createClient from 'openapi-fetch';
import { z } from 'zod';
import { config } from '../config/env';
import { createAuthMiddleware } from './authInterceptor';
import { authProvider } from './client';

/**
 * Typed AI-ideation egress (T1.5, FR-20; TC-31). The real endpoint is backend
 * FR-35 (M12) and is **not yet in the generated openapi** — so this stage uses a
 * small hand-written path type + a dedicated openapi-fetch client that shares the
 * app's base URL, `credentials`, fetch-deferral (so MSW intercepts in tests) and
 * **auth middleware** (header attach + global 401). At T5.3 the generated
 * `paths` supersede {@link IdeationStubPaths} and this collapses into the shared
 * `api` client. The 200 body is runtime-zod-validated (honest parse, not a cast).
 */

export interface AiIdeationRequest {
  readonly template: string;
  readonly seeds: string[];
}

export type AiIdeationResult =
  | { readonly ok: true; readonly keywords: string[] }
  | { readonly ok: false; readonly status: number };

/** Local placeholder openapi path for the not-yet-generated ai-ideation stub. */
interface IdeationStubPaths {
  '/api/v1/ai-ideation': {
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': { template: string; seeds: string[] } } };
      responses: { 200: { content: { 'application/json': { keywords: string[] } } } };
    };
  };
}

const ideationClient = createClient<IdeationStubPaths>({
  baseUrl: config.apiBaseUrl || window.location.origin,
  credentials: 'include',
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});
ideationClient.use(createAuthMiddleware(authProvider));

const KeywordsSchema = z.object({ keywords: z.array(z.string()) });

/**
 * Generate keyword ideas for `{ template, seeds }`. On 200 the (stub) body is
 * validated to `{ keywords }`; a non-2xx (400 = unknown template / empty seeds)
 * or an invalid body degrades to `ok:false` (the card surfaces a generic error).
 */
export async function generateIdeas(body: AiIdeationRequest): Promise<AiIdeationResult> {
  const { data, response } = await ideationClient.POST('/api/v1/ai-ideation', { body });
  if (!response.ok) return { ok: false, status: response.status };
  const parsed = KeywordsSchema.safeParse(data);
  return parsed.success
    ? { ok: true, keywords: parsed.data.keywords }
    : { ok: false, status: response.status };
}
