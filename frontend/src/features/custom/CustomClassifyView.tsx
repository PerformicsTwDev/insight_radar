import { useCallback, useState, type ReactElement } from 'react';
import {
  removeCustomClassification,
  startCustomClassifyAssign,
} from '../../api/customClassifyAssign';
import { useInFlightGuard } from '../../hooks/useInFlightGuard';
import { nextActiveCid, removeTab, upsertTab, type CustomTab } from '../../lib/customView';
import { CustomClassifyJob } from './CustomClassifyJob';
import { CustomClassifyModal } from './CustomClassifyModal';
import { CustomClassifyTable } from './CustomClassifyTable';
import type { EventSourceFactory } from '../job/useJobTracking';

/**
 * 自訂分類 stage-two container (T5.2, FR-16; backend FR-34 · AC-34.2; TC-26 階段二). Owns
 * the dynamic `custom:{cid}` view tabs: `+ 新增自訂分類` opens the T5.1 HITL modal → its
 * confirmed labels enqueue the assignment job ({@link startCustomClassifyAssign}) → the
 * job is tracked (SSE via {@link CustomClassifyJob}, keyed per cid) → on completion a
 * dynamic tab is registered and its 分類表 renders off `POST /query {view:'custom:{cid}'}`.
 * Tabs are deletable behind a confirm ({@link removeCustomClassification}). The two async
 * triggers (start job / confirm delete) are re-entrancy-guarded (M4-R1) so a fast
 * double-click fires exactly ONE request. Standalone component — the dashboard
 * view-content routing (nav integration) is a later task (#443). `eventSourceFactory` is
 * injected in tests; prod uses the default.
 */

const START_ERROR = '建立自訂分類失敗，請稍後再試。';
const JOB_ERROR = '自訂分類歸類失敗，請稍後再試。';
const DELETE_ERROR = '刪除自訂分類失敗，請稍後再試。';

const ADD_BTN =
  'rounded-lg px-3 py-1.5 text-sm font-medium text-brand ring-1 ring-brand/40 enabled:hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-40';
const ACTIVE_TAB = 'px-3 py-1.5 text-sm text-white';
const IDLE_TAB = 'px-3 py-1.5 text-sm text-white/50 hover:bg-white/5 hover:text-white';
const SEC_BTN = 'rounded-lg px-4 py-2 text-sm text-white/70 ring-1 ring-white/10 hover:bg-white/5';
const DANGER_BTN =
  'rounded-lg bg-trend-negative/90 px-4 py-2 text-sm font-semibold text-white hover:bg-trend-negative';

export interface CustomClassifyViewProps {
  readonly analysisId: string;
  readonly eventSourceFactory?: EventSourceFactory;
}

export function CustomClassifyView({
  analysisId,
  eventSourceFactory,
}: CustomClassifyViewProps): ReactElement {
  const [tabs, setTabs] = useState<readonly CustomTab[]>([]);
  const [activeCid, setActiveCid] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // The classify run in flight (its tab is registered only once the job completes).
  const [pending, setPending] = useState<CustomTab | null>(null);
  const [deleting, setDeleting] = useState<CustomTab | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Both triggers stay clickable until their async work resolves, so a fast double-click
  // would otherwise fire a duplicate assignment / delete — guard re-entry (M4-R1, #603).
  const guardStart = useInFlightGuard();
  const guardDelete = useInFlightGuard();

  const openModal = useCallback(() => {
    setError(null);
    setModalOpen(true);
  }, []);

  // Modal `開始分析` → enqueue the assignment job for the confirmed labels. The cid comes
  // from the stage-one classification the modal generated (seam widened at T5.2).
  const handleConfirm = useCallback(
    (classification: { id: string; name: string }, labels: readonly string[]) =>
      guardStart(async () => {
        setError(null);
        const res = await startCustomClassifyAssign(analysisId, classification.id, labels);
        setModalOpen(false);
        if (res.ok) {
          setPending({ cid: classification.id, name: classification.name });
        } else {
          setError(START_ERROR);
        }
      }),
    [analysisId, guardStart],
  );

  // Job completed → register the dynamic tab and switch to it (dedup via upsertTab). Takes
  // the (narrowed, non-null) pending tab from the render scope — no nullable guard here.
  const registerTab = useCallback((tab: CustomTab) => {
    setTabs((prev) => upsertTab(prev, tab));
    setActiveCid(tab.cid);
    setPending(null);
  }, []);

  const handleFailed = useCallback(() => {
    setError(JOB_ERROR);
    setPending(null);
  }, []);

  const handleDelete = useCallback(
    (tab: CustomTab) =>
      guardDelete(async () => {
        const res = await removeCustomClassification(analysisId, tab.cid);
        setDeleting(null);
        if (!res.ok) {
          setError(DELETE_ERROR);
          return;
        }
        const remaining = removeTab(tabs, tab.cid);
        setTabs(remaining);
        setActiveCid((current) => nextActiveCid(remaining, tab.cid, current));
      }),
    [analysisId, guardDelete, tabs],
  );

  return (
    <div className="flex flex-col gap-4">
      <nav
        aria-label="自訂分類"
        className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-2"
      >
        {tabs.map((tab) => {
          const isActive = tab.cid === activeCid;
          return (
            <span
              key={tab.cid}
              className="inline-flex items-center overflow-hidden rounded-lg ring-1 ring-white/10"
            >
              <button
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setActiveCid(tab.cid)}
                className={isActive ? ACTIVE_TAB : IDLE_TAB}
              >
                {tab.name}
              </button>
              <button
                type="button"
                aria-label={`刪除 ${tab.name} 分類`}
                onClick={() => setDeleting(tab)}
                className="px-2 py-1.5 text-xs text-white/40 hover:bg-white/5 hover:text-white"
              >
                ✕
              </button>
            </span>
          );
        })}
        <button type="button" disabled={pending !== null} onClick={openModal} className={ADD_BTN}>
          + 新增自訂分類
        </button>
      </nav>

      {error ? (
        <p role="alert" className="text-sm text-trend-negative">
          {error}
        </p>
      ) : null}

      {pending ? (
        <CustomClassifyJob
          key={pending.cid}
          analysisId={analysisId}
          cid={pending.cid}
          onDone={() => registerTab(pending)}
          onFailed={handleFailed}
          eventSourceFactory={eventSourceFactory}
        />
      ) : activeCid ? (
        <CustomClassifyTable key={activeCid} analysisId={analysisId} cid={activeCid} />
      ) : (
        <p className="rounded-lg border border-white/10 bg-bg-card p-8 text-center text-sm text-white/50">
          尚未建立自訂分類，點「+ 新增自訂分類」開始。
        </p>
      )}

      {modalOpen ? (
        <CustomClassifyModal
          analysisId={analysisId}
          onClose={() => setModalOpen(false)}
          onConfirm={handleConfirm}
        />
      ) : null}

      {deleting ? (
        <ConfirmDeleteDialog
          name={deleting.name}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete(deleting)}
        />
      ) : null}
    </div>
  );
}

/** Confirm gate between a tab's ✕ and the destructive DELETE (no accidental removal). */
function ConfirmDeleteDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="刪除自訂分類"
      className="fixed inset-0 z-[100] flex items-center justify-center"
    >
      <div
        onClick={onCancel}
        aria-hidden="true"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
      />
      <div className="relative w-[92%] max-w-sm rounded-2xl bg-bg-card p-6 shadow-2xl ring-1 ring-white/10">
        <h3 className="text-base font-bold text-white">刪除自訂分類</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          確定要刪除「{name}」分類嗎？此動作無法復原。
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className={SEC_BTN}>
            取消
          </button>
          <button type="button" onClick={onConfirm} className={DANGER_BTN}>
            刪除
          </button>
        </div>
      </div>
    </div>
  );
}
