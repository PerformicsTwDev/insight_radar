import { useState, type ReactElement } from 'react';
import { useInFlightGuard } from '../../hooks/useInFlightGuard';
import {
  addTrackingMembers,
  createTrackingList,
  listTrackingLists,
  type TrackingListSummary,
} from '../../api/trackingLists';
import { useSelectionStore } from '../../stores/selectionStore';
import { dedupedSearchTermCount, selectionContext } from '../../lib/selection';
import { errorResponseMessage, trackingListErrorMessage } from '../../lib/trackingListError';
import { ErrorState, LoadingState } from '../../components/StateViews';

/**
 * Floating bulk bar (T5.4, FR-19 / AC-19.1). Shows「已選 N 項 · 搜尋詞 M 個（已去重）」off the
 * selection store — a topic row flattens into its member keywords and unions with the picked
 * keywords, deduped by `normalizedText` (C7) — and offers「加入搜尋詞追蹤清單」: pick an existing
 * list (`GET /tracking-lists`) or create a new one fixed at the selection's (geo, language)
 * (`POST /tracking-lists`), then `POST /:listId/members` the contract-shaped members. The
 * selection is cleared wholesale after a successful add (AC-19.1). The add trigger is
 * re-entrancy-guarded (M4-R1) so a fast double-click fires exactly ONE POST. A list layer
 * fixes (geo, language), so a mixed-context selection cannot seed a new list (aligns with the
 * backend 400). Tokens only.
 */

// Add / create failures reuse the shared `trackingListErrorMessage` classifier (single source
// with the T5.5 CRUD view) so each cause — 400 geo/language mismatch, 409 cap, 409 name dup,
// 404 not owner — lands its OWN prompt (FR-19 / AC-19.1 boundary; no bespoke mapping here).
const MIXED_HINT = '選取項目的地區 / 語言不一致，無法建立新清單。';

const BAR =
  'fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-white/10 bg-bg-raised px-6 py-3';
const PRIMARY_BTN =
  'rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-bg-body enabled:hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40';
const MENU =
  'absolute bottom-full right-0 mb-2 w-64 rounded-xl bg-bg-card p-2 shadow-2xl ring-1 ring-white/10';
const MENU_ITEM =
  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5';
const TEXT_INPUT =
  'w-full rounded-lg bg-bg-input px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-brand';

export function BulkSelectBar(): ReactElement | null {
  const items = useSelectionStore((s) => s.items);
  const clear = useSelectionStore((s) => s.clear);
  const guardAdd = useInFlightGuard();

  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<TrackingListSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [newMode, setNewMode] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const count = items.length;
  const searchTerms = dedupedSearchTermCount(items);
  const context = selectionContext(items);

  // Rules of Hooks: only bail out AFTER every hook above has run.
  if (count === 0) return null;

  function closePanel(): void {
    setOpen(false);
    setNewMode(false);
    setNewName('');
    setError(null);
  }

  async function loadLists(): Promise<void> {
    setLists(null);
    setLoadFailed(false);
    const res = await listTrackingLists();
    if (res.ok) setLists(res.lists);
    else setLoadFailed(true);
  }

  function togglePanel(): void {
    if (open) {
      closePanel();
      return;
    }
    setOpen(true);
    setError(null);
    void loadLists();
  }

  const addToExisting = (listId: string): Promise<void> =>
    guardAdd(async () => {
      setError(null);
      const res = await addTrackingMembers(listId, items);
      if (res.ok) {
        clear();
        closePanel();
      } else {
        // Selection is NOT cleared on failure — the user can retry after fixing the cause.
        setError(trackingListErrorMessage(res.status, errorResponseMessage(res.error)));
      }
    });

  const createAndAdd = (ctx: { geo: string; language: string }): Promise<void> =>
    guardAdd(async () => {
      setError(null);
      const created = await createTrackingList({ ...ctx, name: newName.trim() });
      if (!created.ok) {
        // A 409 splits into name-collision vs list-count cap by the backend message — the shared
        // classifier resolves it, so a cap is never mislabeled「名稱可能重複」(M5-R1).
        setError(trackingListErrorMessage(created.status, errorResponseMessage(created.error)));
        return;
      }
      const res = await addTrackingMembers(created.list.listId, items);
      if (res.ok) {
        clear();
        closePanel();
      } else {
        setError(trackingListErrorMessage(res.status, errorResponseMessage(res.error)));
      }
    });

  return (
    <div role="region" aria-label="批次選取" className={BAR}>
      <p className="text-sm text-white/80">
        {`已選 ${count} 項 · 搜尋詞 ${searchTerms} 個（已去重）`}
      </p>

      <div className="relative">
        <button type="button" onClick={togglePanel} className={PRIMARY_BTN}>
          加入搜尋詞追蹤清單
        </button>

        {open ? (
          <div role="menu" aria-label="追蹤清單" className={MENU}>
            {error ? (
              <ErrorState message={error} className="mb-2 px-2 text-xs text-trend-negative" />
            ) : null}

            {lists === null && !loadFailed ? (
              <LoadingState className="px-3 py-2 text-xs text-white/40" />
            ) : null}
            {loadFailed ? (
              <ErrorState
                message="清單載入失敗"
                onRetry={() => void loadLists()}
                className="px-3 py-2 text-xs text-trend-negative"
              />
            ) : null}

            {lists?.map((list) => (
              <button
                key={list.listId}
                type="button"
                role="menuitem"
                onClick={() => void addToExisting(list.listId)}
                className={MENU_ITEM}
              >
                <span className="truncate">{list.name}</span>
                {/* Decorative member count — excluded from the menuitem's accessible name. */}
                <span aria-hidden="true" className="ml-2 shrink-0 text-xs text-white/40">
                  {list.memberCount}
                </span>
              </button>
            ))}

            <div className="mt-1 border-t border-white/10 pt-2">
              {newMode ? (
                <div className="flex flex-col gap-2 px-1">
                  <input
                    type="text"
                    aria-label="新清單名稱"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="新清單名稱"
                    autoComplete="off"
                    className={TEXT_INPUT}
                  />
                  {context === null ? (
                    <p className="text-xs text-trend-negative">{MIXED_HINT}</p>
                  ) : null}
                  <button
                    type="button"
                    disabled={context === null || newName.trim().length === 0}
                    onClick={context ? () => void createAndAdd(context) : undefined}
                    className={PRIMARY_BTN}
                  >
                    建立並加入
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setNewMode(true)}
                  className={`${MENU_ITEM} text-brand`}
                >
                  建立新清單
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
