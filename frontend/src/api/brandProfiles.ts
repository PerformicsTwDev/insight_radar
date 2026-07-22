import { z } from 'zod';
import { api } from './client';
import { ErrorResponseSchema, type ErrorResponse } from './keywordAnalyses';
import type { components } from './schema';

/**
 * Typed egress for the brand-profile CRUD (T8.1, FR-22; backend FR-40). The request
 * bodies are bound to the generated `CreateBrandProfileDto` / `UpdateBrandProfileDto`
 * (drift → compile error). Business code calls this — never a bare `fetch`
 * (single-egress, Design §2/§3).
 *
 * **openapi gap (deviation, documented):** the codegen types every 2xx body as
 * `never` (#392), so the response bodies are zod-validated here against the backend
 * `BrandProfileView` (honest runtime parse, not a cast). Same-owner name collisions
 * → 409, cross-owner/unknown single-row → 404, so callers can surface them inline.
 */

export type CreateBrandProfileBody = components['schemas']['CreateBrandProfileDto'];
export type UpdateBrandProfileBody = components['schemas']['UpdateBrandProfileDto'];

/** Brand / competitor entry (backend `BrandEntry`). */
const BrandEntrySchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  sites: z.array(z.string()),
});

/** Brand profile (backend `BrandProfileView`; `ownerId` is never exposed). */
const BrandProfileViewSchema = z.object({
  id: z.string().min(1),
  brand: BrandEntrySchema,
  competitors: z.array(BrandEntrySchema),
  createdAt: z.string(),
});

export type BrandEntry = z.infer<typeof BrandEntrySchema>;
export type BrandProfileView = z.infer<typeof BrandProfileViewSchema>;

export type BrandProfileResult =
  | { readonly ok: true; readonly profile: BrandProfileView }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

function parseProfile(data: unknown, response: Response): BrandProfileResult {
  const parsed = BrandProfileViewSchema.safeParse(data);
  return parsed.success
    ? { ok: true, profile: parsed.data }
    : { ok: false, status: response.status };
}

function toError(error: unknown, response: Response): BrandProfileResult {
  const parsed = ErrorResponseSchema.safeParse(error);
  return { ok: false, status: response.status, error: parsed.success ? parsed.data : undefined };
}

/**
 * Create a brand profile. On 201 the (untyped) body is zod-validated to `{ ok: true,
 * profile }`; a 409 (same-owner duplicate name), 400 (field errors), or an invalid
 * 201 body all degrade to `ok:false` so the AI-home form can surface it inline.
 */
export async function createBrandProfile(
  body: CreateBrandProfileBody,
): Promise<BrandProfileResult> {
  const { data, error, response } = await api.POST('/api/v1/brand-profiles', { body });
  return response.ok ? parseProfile(data, response) : toError(error, response);
}

export type ListBrandProfilesResult =
  | { readonly ok: true; readonly profiles: readonly BrandProfileView[] }
  | { readonly ok: false; readonly status: number };

/** List the owner-scoped brand profiles (`GET /brand-profiles`). Never throws. */
export async function listBrandProfiles(): Promise<ListBrandProfilesResult> {
  const { data, response } = await api.GET('/api/v1/brand-profiles');
  if (!response.ok) return { ok: false, status: response.status };
  const parsed = z.array(BrandProfileViewSchema).safeParse(data);
  return parsed.success
    ? { ok: true, profiles: parsed.data }
    : { ok: false, status: response.status };
}

/** Fetch one brand profile (`GET :id`). Cross-owner / unknown → 404 (`ok:false`). */
export async function getBrandProfile(id: string): Promise<BrandProfileResult> {
  const { data, error, response } = await api.GET('/api/v1/brand-profiles/{id}', {
    params: { path: { id } },
  });
  return response.ok ? parseProfile(data, response) : toError(error, response);
}

/** Update one brand profile (`PATCH :id`). Cross-owner / unknown → 404; dup name → 409. */
export async function updateBrandProfile(
  id: string,
  body: UpdateBrandProfileBody,
): Promise<BrandProfileResult> {
  const { data, error, response } = await api.PATCH('/api/v1/brand-profiles/{id}', {
    params: { path: { id } },
    body,
  });
  return response.ok ? parseProfile(data, response) : toError(error, response);
}

/** Delete one brand profile (`DELETE :id`). Returns whether the backend accepted it. */
export async function removeBrandProfile(id: string): Promise<boolean> {
  const { response } = await api.DELETE('/api/v1/brand-profiles/{id}', {
    params: { path: { id } },
  });
  return response.ok;
}

/*
 * Note: ✦ AI 別名補全 has **no client egress**. Its dedicated backend endpoint
 * (`backend:AC-40.2` brand-alias-extractor) is undelivered, and the FR-20
 * `/ai-ideation` endpoint returns competitor/comparison terms (not same-brand
 * aliases), so wiring it here would pollute canonical `BrandProfile.aliases`.
 * The front end renders it as a disabled roadmap affordance (FR-22 revision
 * 2026-07-23) until the backend endpoint ships; there is nothing to call.
 */
