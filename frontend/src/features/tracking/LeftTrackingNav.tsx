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
    // v4 `相關搜尋詞追蹤清單` section: border-t divider, wide-tracking bold label, then
    // `.tracking-list-btn` rows (📂 + truncated name, gap-9, 13px/600).
    <nav aria-label="相關搜尋詞追蹤清單" className="mt-3 border-t border-white/10 px-2 pt-3">
      <h3 className="mb-2 px-1 text-[12px] font-bold tracking-widest text-white/40">
        相關搜尋詞追蹤清單
      </h3>
      <ul className="flex flex-col gap-1">
        {lists.map((list) => (
          <li key={list.listId}>
            <button
              type="button"
              onClick={() => onSelect(list.listId)}
              className="flex w-full items-center gap-[9px] rounded-lg py-2.5 pl-3.5 pr-3 text-left text-[13px] font-semibold text-white/[0.66] transition hover:bg-white/[0.045] hover:text-white/90"
            >
              <span aria-hidden="true">📂</span>
              <span className="min-w-0 truncate">{list.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
