import { create } from 'zustand';
import type { SelectionItem } from '../lib/selection';

/**
 * SHELL (T5.4 red) — not implemented yet.
 */

export interface SelectionState {
  readonly items: SelectionItem[];
  toggle: (item: SelectionItem) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>(() => ({
  items: [],
  toggle: () => {
    throw new Error('not implemented');
  },
  clear: () => {
    throw new Error('not implemented');
  },
}));
