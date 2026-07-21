import { create } from 'zustand';
import { toggleSelection, type SelectionItem } from '../lib/selection';

/**
 * The client-only bulk selection set (T5.4, FR-19; Design §71-72). Zustand — **not**
 * server state — holds the keywords / topics picked across views, keyed by
 * `normalizedText` (C7, via the `toggleSelection` single point) so picks accumulate
 * across filtering / paging without rowIdx drift. Wholesale-cleared after a successful
 * add. UI reads it with the `useSelectionStore` hook; tests seed it via `setState`.
 */

export interface SelectionState {
  readonly items: SelectionItem[];
  /** Toggle a picked keyword / topic in or out of the set (dedupe by `normalizedText`). */
  toggle: (item: SelectionItem) => void;
  /** Drop the whole selection (after a successful add, or an explicit clear). */
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  items: [],
  toggle: (item) => set((state) => ({ items: toggleSelection(state.items, item) })),
  clear: () => set({ items: [] }),
}));
