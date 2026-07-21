import { z } from 'zod';
import { api } from './client';
import { ErrorResponseSchema, type ErrorResponse } from './keywordAnalyses';
import { toMemberItems, type SelectionItem } from '../lib/selection';
import type { components } from './schema';

/**
 * Typed egress for the tracking-list bulk-add flow (T5.4, FR-19; backend FR-28 /
 * AC-28.1/28.3/28.4/28.5). Business code calls these — never a bare `fetch`
 * (single-egress, Design §2/§3).
 *
 * **openapi gap (deviation, documented):** the backend `openapi.json` declares **no**
 * response body schema for `GET /tracking-lists`, the 201 create, or the 200 add
 * (`content: never`, #392 class), so the codegen'd `paths` type the bodies as `never`.
 * openapi-fetch still parses the JSON at runtime, so those bodies are zod-validated here
 * (honest parse, not a cast) against the backend contract (`TrackingListSummary[]` /
 * `TrackingListView` / `AddMembersResult`). The **request** bodies stay bound to the
 * generated `CreateTrackingListDto` / `AddMembersDto` (drift → compile error). Never
 * throws — a 400 (geo/language context mismatch), 409 (duplicate name / member cap), 404
 * (unknown / not owner), or an invalid body all degrade to `ok:false` with the status.
 */

/** Create body — bound to the generated openapi DTO (drift → compile error). */
export type CreateTrackingListBody = components['schemas']['CreateTrackingListDto'];

/** One list row (backend `TrackingListSummary`; `createdAt` ISO over the wire). */
const TrackingListSummarySchema = z.object({
  listId: z.string().min(1),
  name: z.string(),
  geo: z.string(),
  language: z.string(),
  createdAt: z.string(),
  memberCount: z.number(),
});
export type TrackingListSummary = z.infer<typeof TrackingListSummarySchema>;

/** Created / renamed list (backend `TrackingListView`). */
const TrackingListViewSchema = z.object({
  listId: z.string().min(1),
  name: z.string(),
  geo: z.string(),
  language: z.string(),
  createdAt: z.string(),
});
export type TrackingListView = z.infer<typeof TrackingListViewSchema>;

/** Add-members result (backend `AddMembersResult`): `added` = new members, `memberCount` = total. */
const AddMembersResultSchema = z.object({
  memberCount: z.number(),
  added: z.number(),
});
export type AddMembersResult = z.infer<typeof AddMembersResultSchema>;

export type ListTrackingListsResult =
  | { readonly ok: true; readonly lists: TrackingListSummary[] }
  | { readonly ok: false; readonly status: number };

export type CreateTrackingListResult =
  | { readonly ok: true; readonly list: TrackingListView }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

export type AddTrackingMembersResult =
  | { readonly ok: true; readonly result: AddMembersResult }
  | { readonly ok: false; readonly status: number };

/**
 * List the owner's tracking lists (the add dropdown's existing-list source; AC-28.3). On
 * 200 the (openapi-untyped) body is zod-validated to `TrackingListSummary[]`; any non-2xx
 * or a schema-invalid body degrades to `ok:false`.
 */
export async function listTrackingLists(): Promise<ListTrackingListsResult> {
  const { data, response } = await api.GET('/api/v1/tracking-lists');
  if (response.ok) {
    const parsed = z.array(TrackingListSummarySchema).safeParse(data);
    if (parsed.success) return { ok: true, lists: parsed.data };
    return { ok: false, status: response.status };
  }
  return { ok: false, status: response.status };
}

/**
 * Create a new tracking list fixed at `{ geo, language, name }` (AC-28.1). On 201 the
 * (openapi-untyped) body is zod-validated to `TrackingListView`; a 409 (duplicate name),
 * or a 201 without a valid list, degrades to `ok:false` with the status.
 */
export async function createTrackingList(
  body: CreateTrackingListBody,
): Promise<CreateTrackingListResult> {
  const { data, error, response } = await api.POST('/api/v1/tracking-lists', { body });
  if (response.ok) {
    const parsed = TrackingListViewSchema.safeParse(data);
    if (parsed.success) return { ok: true, list: parsed.data };
    return { ok: false, status: response.status };
  }
  // Carry the `ErrorResponse` body so callers can split the two 409 causes (duplicate name
  // vs list-count cap) — both arrive with `code:'CONFLICT'`, so only the message separates
  // them (see `trackingListErrorMessage`). No body → `error` undefined (still `ok:false`).
  return { ok: false, status: response.status, error: parseError(error) };
}

/**
 * Add the selected keywords / topics to a list (AC-28.4/28.5). The selection is mapped to
 * the contract-shaped `AddMembersDto` (keyword → text+geo+language, topic →
 * analysisId+topicName; the server dedupes by `normalizedText` and expands topics). On
 * 200 the (openapi-untyped) body is zod-validated to `AddMembersResult`; a 400 (context
 * mismatch), 409 (member cap), 404 (unknown / not owner), or an invalid body degrades to
 * `ok:false` with the status.
 */
export async function addTrackingMembers(
  listId: string,
  items: readonly SelectionItem[],
): Promise<AddTrackingMembersResult> {
  const { data, response } = await api.POST('/api/v1/tracking-lists/{listId}/members', {
    params: { path: { listId } },
    body: { items: toMemberItems(items) },
  });
  if (response.ok) {
    const parsed = AddMembersResultSchema.safeParse(data);
    if (parsed.success) return { ok: true, result: parsed.data };
    return { ok: false, status: response.status };
  }
  return { ok: false, status: response.status };
}

// ── List CRUD + member removal (T5.5, FR-19; backend FR-28 · AC-28.1/28.2/28.3/28.6) ──
//
// Same openapi gap as the T5.4 egress: `getDetail` / `rename` / `remove` / `removeMember`
// declare no response body (`content: never`, #392 class), so 2xx bodies are zod-validated
// here (honest parse, not a cast). Never throw — a 400 (context mismatch), 409 (duplicate
// name / cap), or 404 (unknown / not owner) degrades to `ok:false` carrying the status AND
// the parsed `ErrorResponse` (so callers can split the two 409 causes via the message).

/** One tracking-list member (backend `TrackingListMemberView`; dates ISO over the wire). */
const TrackingListMemberSchema = z.object({
  normalizedText: z.string(),
  text: z.string(),
  addedAt: z.string(),
  lastCheckedAt: z.string().nullable(),
});
export type TrackingListMember = z.infer<typeof TrackingListMemberSchema>;

/** List detail (backend `TrackingListDetail`): metadata + member basics. */
const TrackingListDetailSchema = TrackingListViewSchema.extend({
  members: z.array(TrackingListMemberSchema),
});
export type TrackingListDetail = z.infer<typeof TrackingListDetailSchema>;

export type GetTrackingListDetailResult =
  | { readonly ok: true; readonly detail: TrackingListDetail }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

export type RenameTrackingListResult =
  | { readonly ok: true; readonly list: TrackingListView }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

export type MutateTrackingListResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: number; readonly error?: ErrorResponse };

/** Parse a non-2xx body against `ErrorResponse` (undefined when absent / malformed). */
function parseError(error: unknown): ErrorResponse | undefined {
  const parsed = ErrorResponseSchema.safeParse(error);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Load a list's metadata + members (the CRUD detail panel; AC-28.3). On 200 the
 * openapi-untyped body is zod-validated to `TrackingListDetail`; a 404 (unknown / not
 * owner) or an invalid body degrades to `ok:false`.
 */
export async function getTrackingListDetail(listId: string): Promise<GetTrackingListDetailResult> {
  const { data, error, response } = await api.GET('/api/v1/tracking-lists/{listId}', {
    params: { path: { listId } },
  });
  if (response.ok) {
    const parsed = TrackingListDetailSchema.safeParse(data);
    if (parsed.success) return { ok: true, detail: parsed.data };
    return { ok: false, status: response.status };
  }
  return { ok: false, status: response.status, error: parseError(error) };
}

/**
 * Rename a list (AC-28.2). The request body is bound to the generated `RenameTrackingListDto`
 * (`{ name }`, drift → compile error); on 200 the openapi-untyped body is zod-validated to
 * `TrackingListView`. A 409 (duplicate name), 404 (not owner), or invalid body degrades to
 * `ok:false` (409 carries the `ErrorResponse` for the name-vs-cap split).
 */
export async function renameTrackingList(
  listId: string,
  name: string,
): Promise<RenameTrackingListResult> {
  const { data, error, response } = await api.PATCH('/api/v1/tracking-lists/{listId}', {
    params: { path: { listId } },
    body: { name },
  });
  if (response.ok) {
    const parsed = TrackingListViewSchema.safeParse(data);
    if (parsed.success) return { ok: true, list: parsed.data };
    return { ok: false, status: response.status };
  }
  return { ok: false, status: response.status, error: parseError(error) };
}

/**
 * Delete a list (AC-28.2; members cascade via FK). Success is confirmatory only (the caller
 * already knows the id), so this returns `{ ok:true }`; a 404 (not owner) degrades to
 * `ok:false` with the status.
 */
export async function deleteTrackingList(listId: string): Promise<MutateTrackingListResult> {
  const { error, response } = await api.DELETE('/api/v1/tracking-lists/{listId}', {
    params: { path: { listId } },
  });
  if (response.ok) return { ok: true };
  return { ok: false, status: response.status, error: parseError(error) };
}

/**
 * Remove one member by `normalizedText` (AC-28.6; the server re-normalizes S4 before
 * matching). openapi-fetch percent-encodes the path segment. A 404 (member / list not found
 * or not owner) degrades to `ok:false` with the status.
 */
export async function removeTrackingMember(
  listId: string,
  normalizedText: string,
): Promise<MutateTrackingListResult> {
  const { error, response } = await api.DELETE(
    '/api/v1/tracking-lists/{listId}/members/{normalizedText}',
    { params: { path: { listId, normalizedText } } },
  );
  if (response.ok) return { ok: true };
  return { ok: false, status: response.status, error: parseError(error) };
}
