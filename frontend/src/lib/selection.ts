import type { components } from '../api/schema';

/**
 * SHELL (T5.4 red) — not implemented yet.
 */

export type MemberItemDto = components['schemas']['MemberItemDto'];

export interface KeywordSelection {
  readonly kind: 'keyword';
  readonly text: string;
  readonly geo: string;
  readonly language: string;
  readonly analysisId?: string;
}

export interface TopicSelection {
  readonly kind: 'topic';
  readonly analysisId: string;
  readonly topicName: string;
  readonly geo: string;
  readonly language: string;
  readonly members: readonly string[];
}

export type SelectionItem = KeywordSelection | TopicSelection;

export function selectionKey(_item: SelectionItem): string {
  throw new Error('not implemented');
}

export function toggleSelection(
  _items: readonly SelectionItem[],
  _item: SelectionItem,
): SelectionItem[] {
  throw new Error('not implemented');
}

export function expandToSearchTerms(_items: readonly SelectionItem[]): string[] {
  throw new Error('not implemented');
}

export function dedupedSearchTermCount(_items: readonly SelectionItem[]): number {
  throw new Error('not implemented');
}

export function selectionContext(
  _items: readonly SelectionItem[],
): { geo: string; language: string } | null {
  throw new Error('not implemented');
}

export function toMemberItems(_items: readonly SelectionItem[]): MemberItemDto[] {
  throw new Error('not implemented');
}
