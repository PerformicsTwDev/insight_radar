import { useState, type ReactElement } from 'react';
import { useInFlightGuard } from '../../hooks/useInFlightGuard';
import {
  createTrackingList,
  deleteTrackingList,
  getTrackingListDetail,
  removeTrackingMember,
  renameTrackingList,
  type TrackingListMember,
  type TrackingListSummary,
} from '../../api/trackingLists';
import { trackingListErrorMessage } from '../../lib/trackingListError';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useTrackingLists } from './useTrackingLists';

/**
 * Global tracking-list management view (T5.5/T5.7, FR-19; backend FR-28 · AC-28.1/28.2/28.3/28.6).
 * Tracking lists are cross-analysis entities with their own top-level entry (T5.7 routes it at
 * `/tracking`), so this owns the CRUD surface: list the owner's lists (via the shared
 * {@link useTrackingLists} read hook), create one fixed at `(name, geo, language)`, rename it
 * (PATCH `{name}`), delete it, and — after opening a list's members — remove a member. A row's
 * 開啟 navigates to the list's time-series detail (`/tracking/$listId`) via the injected
 * {@link TrackingListsViewProps.onOpenList} (router-agnostic so it stays unit-testable). Every
 * failure code lands its OWN readable prompt via {@link trackingListErrorMessage} (the inline
 * error convention T6.1 hoists into a shared toast). The two destructive triggers (delete list /
 * remove member) sit behind a confirm dialog and are re-entrancy-guarded (M4-R1) so a fast
 * double-click fires exactly ONE DELETE. Tokens only.
 */

export interface TrackingListsViewProps {
  /**
   * Navigate to a list's time-series detail (`/tracking/$listId`). Injected by the
   * route wrapper so this view stays router-agnostic (and unit-testable bare). When
   * absent (e.g. an isolated render) the per-row 開啟 affordance is not shown.
   */
  readonly onOpenList?: (listId: string) => void;
}

const SECTION = 'flex flex-col gap-6';
const CARD = 'rounded-xl bg-bg-card p-4 ring-1 ring-white/10';
const PRIMARY_BTN =
  'rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-bg-body enabled:hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40';
const SEC_BTN =
  'rounded-lg px-3 py-1.5 text-sm text-white/70 ring-1 ring-white/10 hover:bg-white/5';
const LINK_BTN = 'text-sm font-medium text-white hover:text-brand';
const GHOST_BTN = 'rounded-lg px-2 py-1 text-xs text-white/50 hover:bg-white/5 hover:text-white';
const TEXT_INPUT =
  'w-full rounded-lg bg-bg-input px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-brand';
const FIELD_LABEL = 'mb-1 block text-xs font-medium text-white/60';

export function TrackingListsView({ onOpenList }: TrackingListsViewProps = {}): ReactElement {
  // Lists come from the shared read hook (also used by the future results-page sidebar,
  // #443); `setLists` lets create/rename/delete mutate the array optimistically (no refetch).
  const { lists, setLists, loading: listsLoading, failed: loadFailed } = useTrackingLists();
  const [error, setError] = useState<string | null>(null);

  // Create form (list layer fixes geo/language, AC-28.5) — all three required (AC-28.1).
  const [name, setName] = useState('');
  const [geo, setGeo] = useState('');
  const [language, setLanguage] = useState('');

  // Inline rename (one row at a time), detail panel, and the two confirm gates.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  // Members of the open list — a plain array (never null) so removal filters cleanly; a
  // separate `membersLoading` flag models the fetch (no nullable state → no dead branch).
  const [members, setMembers] = useState<TrackingListMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);
  const [deletingList, setDeletingList] = useState<TrackingListSummary | null>(null);
  // Carry the owning listId alongside the member so removal never needs to re-derive it.
  const [removingMember, setRemovingMember] = useState<MemberTarget | null>(null);

  // Every async trigger stays clickable until its request resolves → guard re-entry (M4-R1).
  const guardCreate = useInFlightGuard();
  const guardRename = useInFlightGuard();
  const guardDelete = useInFlightGuard();
  const guardRemove = useInFlightGuard();

  const canCreate = name.trim().length > 0 && geo.trim().length > 0 && language.trim().length > 0;

  const handleCreate = (): Promise<void> =>
    guardCreate(async () => {
      setError(null);
      const res = await createTrackingList({
        name: name.trim(),
        geo: geo.trim(),
        language: language.trim(),
      });
      if (res.ok) {
        // Append the created list locally (memberCount 0) — no reload round-trip needed.
        setLists((prev) => [...prev, { ...res.list, memberCount: 0 }]);
        setName('');
        setGeo('');
        setLanguage('');
      } else {
        setError(trackingListErrorMessage(res.status, messageOf(res.error)));
      }
    });

  const startRename = (list: TrackingListSummary): void => {
    setError(null);
    setRenamingId(list.listId);
    setRenameValue(list.name);
  };

  const handleRename = (list: TrackingListSummary): Promise<void> =>
    guardRename(async () => {
      setError(null);
      const res = await renameTrackingList(list.listId, renameValue.trim());
      if (res.ok) {
        setLists((prev) =>
          prev.map((l) => (l.listId === list.listId ? { ...l, name: res.list.name } : l)),
        );
        setRenamingId(null);
      } else {
        setError(trackingListErrorMessage(res.status, messageOf(res.error)));
      }
    });

  const handleDeleteList = (list: TrackingListSummary): Promise<void> =>
    guardDelete(async () => {
      setError(null);
      const res = await deleteTrackingList(list.listId);
      setDeletingList(null);
      if (res.ok) {
        setLists((prev) => prev.filter((l) => l.listId !== list.listId));
        if (selectedListId === list.listId) {
          setSelectedListId(null);
          setMembers([]);
        }
      } else {
        setError(trackingListErrorMessage(res.status, messageOf(res.error)));
      }
    });

  const selectList = async (list: TrackingListSummary): Promise<void> => {
    setError(null);
    setSelectedListId(list.listId);
    setMembers([]);
    setMembersLoading(true);
    setDetailFailed(false);
    const res = await getTrackingListDetail(list.listId);
    setMembersLoading(false);
    if (res.ok) setMembers(res.detail.members);
    else setDetailFailed(true);
  };

  const handleRemoveMember = (target: MemberTarget): Promise<void> =>
    guardRemove(async () => {
      setError(null);
      const res = await removeTrackingMember(target.listId, target.member.normalizedText);
      setRemovingMember(null);
      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.normalizedText !== target.member.normalizedText));
      } else {
        setError(trackingListErrorMessage(res.status, messageOf(res.error)));
      }
    });

  return (
    <section aria-label="追蹤清單管理" className={SECTION}>
      {error ? (
        <p role="alert" className="text-sm text-trend-negative">
          {error}
        </p>
      ) : null}

      <CreateListForm
        name={name}
        geo={geo}
        language={language}
        canCreate={canCreate}
        onName={setName}
        onGeo={setGeo}
        onLanguage={setLanguage}
        onCreate={() => void handleCreate()}
      />

      <div className={CARD}>
        <h2 className="mb-3 text-sm font-semibold text-white/80">追蹤清單</h2>
        {listsLoading ? <p className="text-sm text-white/40">載入中…</p> : null}
        {loadFailed ? <p className="text-sm text-trend-negative">清單載入失敗</p> : null}
        {!listsLoading && !loadFailed && lists.length === 0 ? (
          <p className="text-sm text-white/40">尚無追蹤清單，先在上方建立一個。</p>
        ) : null}

        <ul className="flex flex-col divide-y divide-white/5">
          {lists.map((list) => (
            <li key={list.listId} className="flex flex-col gap-2 py-3">
              {renamingId === list.listId ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    aria-label={`重新命名 ${list.name}`}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoComplete="off"
                    className={TEXT_INPUT}
                  />
                  <button
                    type="button"
                    disabled={renameValue.trim().length === 0}
                    onClick={() => void handleRename(list)}
                    className={PRIMARY_BTN}
                  >
                    儲存名稱
                  </button>
                  <button type="button" onClick={() => setRenamingId(null)} className={SEC_BTN}>
                    取消
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-baseline gap-3">
                    <button
                      type="button"
                      aria-label={`檢視 ${list.name} 成員`}
                      onClick={() => void selectList(list)}
                      className={LINK_BTN}
                    >
                      {list.name}
                    </button>
                    <span className="text-xs text-white/40">
                      {list.geo} · {list.language} · {list.memberCount} 個成員
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {onOpenList ? (
                      <button
                        type="button"
                        aria-label={`開啟 ${list.name}`}
                        onClick={() => onOpenList(list.listId)}
                        className={GHOST_BTN}
                      >
                        開啟
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`改名 ${list.name}`}
                      onClick={() => startRename(list)}
                      className={GHOST_BTN}
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      aria-label={`刪除 ${list.name}`}
                      onClick={() => setDeletingList(list)}
                      className={GHOST_BTN}
                    >
                      刪除
                    </button>
                  </div>
                </div>
              )}

              {selectedListId === list.listId ? (
                <MemberPanel
                  members={members}
                  loading={membersLoading}
                  failed={detailFailed}
                  onRemove={(member) => setRemovingMember({ listId: list.listId, member })}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {deletingList ? (
        <ConfirmDialog
          title="刪除清單"
          body={`確定要刪除「${deletingList.name}」清單嗎？清單內所有成員也會一併移除，此動作無法復原。`}
          confirmLabel="確定刪除"
          onCancel={() => setDeletingList(null)}
          onConfirm={() => void handleDeleteList(deletingList)}
        />
      ) : null}

      {removingMember ? (
        <ConfirmDialog
          title="移除成員"
          body={`確定要把「${removingMember.member.text}」移出這個追蹤清單嗎？`}
          confirmLabel="確定移除"
          onCancel={() => setRemovingMember(null)}
          onConfirm={() => void handleRemoveMember(removingMember)}
        />
      ) : null}
    </section>
  );
}

/** A member plus the list it belongs to — captured when the remove is requested. */
interface MemberTarget {
  readonly listId: string;
  readonly member: TrackingListMember;
}

/**
 * Backend `ErrorResponse.message` reduced to a plain string for the 409 name-vs-cap split.
 * Real 409/404 messages are strings; a non-string (absent, or a validation `string[]`) is not
 * consulted by the classifier, so it maps to `undefined` (→ the default 409 = name collision).
 */
function messageOf(error?: { message?: string | string[] }): string | undefined {
  return typeof error?.message === 'string' ? error.message : undefined;
}

/** New-list form — the create button stays disabled until name, geo and language are set. */
function CreateListForm({
  name,
  geo,
  language,
  canCreate,
  onName,
  onGeo,
  onLanguage,
  onCreate,
}: {
  name: string;
  geo: string;
  language: string;
  canCreate: boolean;
  onName: (v: string) => void;
  onGeo: (v: string) => void;
  onLanguage: (v: string) => void;
  onCreate: () => void;
}): ReactElement {
  return (
    <form
      className={CARD}
      onSubmit={(e) => {
        e.preventDefault();
        if (canCreate) onCreate();
      }}
    >
      <h2 className="mb-3 text-sm font-semibold text-white/80">建立追蹤清單</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="tl-name" className={FIELD_LABEL}>
            清單名稱
          </label>
          <input
            id="tl-name"
            type="text"
            aria-label="清單名稱"
            value={name}
            onChange={(e) => onName(e.target.value)}
            autoComplete="off"
            className={TEXT_INPUT}
          />
        </div>
        <div>
          <label htmlFor="tl-geo" className={FIELD_LABEL}>
            地區 (geo)
          </label>
          <input
            id="tl-geo"
            type="text"
            aria-label="地區 (geo)"
            value={geo}
            onChange={(e) => onGeo(e.target.value)}
            autoComplete="off"
            className={TEXT_INPUT}
          />
        </div>
        <div>
          <label htmlFor="tl-language" className={FIELD_LABEL}>
            語言 (language)
          </label>
          <input
            id="tl-language"
            type="text"
            aria-label="語言 (language)"
            value={language}
            onChange={(e) => onLanguage(e.target.value)}
            autoComplete="off"
            className={TEXT_INPUT}
          />
        </div>
      </div>
      <div className="mt-3">
        <button type="submit" disabled={!canCreate} className={PRIMARY_BTN}>
          建立清單
        </button>
      </div>
    </form>
  );
}

/** A selected list's members with per-member remove (AC-28.6). */
function MemberPanel({
  members,
  loading,
  failed,
  onRemove,
}: {
  members: readonly TrackingListMember[];
  loading: boolean;
  failed: boolean;
  onRemove: (member: TrackingListMember) => void;
}): ReactElement {
  return (
    <div className="mt-1 rounded-lg bg-bg-input/40 p-3 ring-1 ring-white/5">
      {failed ? <p className="text-sm text-trend-negative">成員載入失敗</p> : null}
      {loading ? <p className="text-sm text-white/40">載入成員中…</p> : null}
      {!loading && !failed && members.length === 0 ? (
        <p className="text-sm text-white/40">此清單尚無成員。</p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li key={member.normalizedText} className="flex items-center justify-between gap-3">
            <span className="text-sm text-white/80">{member.text}</span>
            <button
              type="button"
              aria-label={`移除 ${member.text}`}
              onClick={() => onRemove(member)}
              className={GHOST_BTN}
            >
              移除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
