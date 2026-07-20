import { z } from 'zod';
import type { components } from './schema';
import type { SelectionItem } from '../lib/selection';

/**
 * SHELL (T5.4 red) — not implemented yet.
 */

export type CreateTrackingListBody = components['schemas']['CreateTrackingListDto'];

const TrackingListSummarySchema = z.object({
  listId: z.string().min(1),
  name: z.string(),
  geo: z.string(),
  language: z.string(),
  createdAt: z.string(),
  memberCount: z.number(),
});
export type TrackingListSummary = z.infer<typeof TrackingListSummarySchema>;

const TrackingListViewSchema = z.object({
  listId: z.string().min(1),
  name: z.string(),
  geo: z.string(),
  language: z.string(),
  createdAt: z.string(),
});
export type TrackingListView = z.infer<typeof TrackingListViewSchema>;

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
  | { readonly ok: false; readonly status: number };

export type AddTrackingMembersResult =
  | { readonly ok: true; readonly result: AddMembersResult }
  | { readonly ok: false; readonly status: number };

export function listTrackingLists(): Promise<ListTrackingListsResult> {
  throw new Error('not implemented');
}

export function createTrackingList(
  _body: CreateTrackingListBody,
): Promise<CreateTrackingListResult> {
  throw new Error('not implemented');
}

export function addTrackingMembers(
  _listId: string,
  _items: readonly SelectionItem[],
): Promise<AddTrackingMembersResult> {
  throw new Error('not implemented');
}
