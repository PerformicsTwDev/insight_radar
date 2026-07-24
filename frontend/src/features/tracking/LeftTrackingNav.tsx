import type { ReactElement } from 'react';
import { useTrackingLists } from './useTrackingLists';

/**
 * Left-column 相關搜尋詞追蹤清單 section (M7-R5, FR-1 / TC-58 v4 fidelity): stacked below the
 * dimension menu in the results context, it lists the owner's tracking lists (cross-analysis
 * globals, via {@link useTrackingLists}). Clicking one navigates to its detail — `onSelect` is
 * injected by the router-aware container (RootLayout) so this component stays router-free and
 * unit-testable. Renders nothing when there are no lists (no empty section). Tokens only.
 */
export function LeftTrackingNav({
  onSelect,
}: {
  readonly onSelect: (listId: string) => void;
}): ReactElement | null {
  const { lists } = useTrackingLists();
  if (lists.length === 0) return null;

  return (
    <nav aria-label="相關搜尋詞追蹤清單" className="mt-4 border-t border-white/10 pt-4">
      <h3 className="mb-2 px-3 text-xs font-medium text-white/40">相關搜尋詞追蹤清單</h3>
      <ul className="flex flex-col gap-1">
        {lists.map((list) => (
          <li key={list.listId}>
            <button
              type="button"
              onClick={() => onSelect(list.listId)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/70 hover:bg-white/5 hover:text-white"
            >
              <span aria-hidden="true">📁</span>
              <span className="min-w-0 truncate">{list.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
