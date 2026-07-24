import { useState } from 'react';
import { getTrackingListDetail, type TrackingListSummary } from '../../api/trackingLists';
import { config } from '../../config/env';
import { useInFlightGuard } from '../../hooks/useInFlightGuard';
import { useTrackingLists } from '../tracking/useTrackingLists';

/**
 * "從追蹤清單繼續" home entry region (T7.7, FR-2 AC-2.3 / FR-19; TC-71). Sits ABOVE
 * the 開始新的分析 create card and lets the owner continue an analysis from a saved
 * tracking list: each card shows the list NAME + `N 個字詞` (memberCount) only — no
 * geo / volume / sparkline (the `GET /tracking-lists` summary carries no aggregate
 * search volume, so none is fabricated, C14 spirit). Clicking 繼續 loads that list's
 * members (`GET /tracking-lists/:id`) into the create form's seeds (C7-deduped by the
 * host) and prefills the list-layer-fixed geo/language (AC-28.5), so the user can hit
 * 開始分析 straight away — the create flow itself stays the same `POST /keyword-analyses`
 * contract (no new endpoint).
 *
 * **Hidden when there is nothing to continue** (AC-2.3): while the list read is loading,
 * on a `GET /tracking-lists` failure, or when the owner has zero lists, the whole
 * section renders `null` (never drawn empty / faked). Router-agnostic: 查看更多 →
 * {@link onSeeMore} (injected), like {@link TrackingListsView}. Tokens only.
 */

export interface TrackingContinueSectionProps {
  /**
   * Continue from a list: its member seeds + list-fixed geo/language flow into the
   * create form (the host de-dupes seeds via C7 and prefills the advanced options).
   */
  readonly onContinue: (seeds: string[], geo: string, language: string) => void;
  /** Navigate to the full tracking-list page (查看更多). Injected → router-agnostic. */
  readonly onSeeMore: () => void;
}

export function TrackingContinueSection({ onContinue, onSeeMore }: TrackingContinueSectionProps) {
  const { lists, loading, failed } = useTrackingLists();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  // Re-entrancy guard (M7-R10): a single `loadingId` disables only the clicked card, so a
  // second card's click could launch a concurrent duplicate fetch. This ref-based guard
  // ignores any 繼續 click while one is already in flight (mirrors the ✦ cell / topics start).
  const guardContinue = useInFlightGuard();

  // Nothing to continue → render nothing (AC-2.3: hidden, not drawn empty / faked).
  if (loading || failed || lists.length === 0) return null;

  const shown = lists.slice(0, config.trackingContinueTopN);
  const remaining = lists.length - shown.length;

  // Only reachable for non-empty lists — the 繼續 button is `disabled` when memberCount === 0.
  function handleContinue(list: TrackingListSummary): Promise<void> {
    return guardContinue(async () => {
      setLoadingId(list.listId);
      const res = await getTrackingListDetail(list.listId);
      setLoadingId(null);
      // On failure leave the form untouched (spec: 載入 members 失敗 → 不改動現有 seeds).
      if (res.ok) {
        onContinue(
          res.detail.members.map((m) => m.normalizedText),
          list.geo,
          list.language,
        );
      }
    });
  }

  return (
    <section aria-labelledby="tracking-continue-heading" className="mb-8">
      <h2 id="tracking-continue-heading" className="mb-4 text-base font-bold text-white/90">
        從追蹤清單繼續
      </h2>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((list) => {
          const empty = list.memberCount === 0;
          const busy = loadingId === list.listId;
          return (
            <li
              key={list.listId}
              className="flex flex-col gap-3 rounded-xl bg-bg-card p-4 ring-1 ring-white/10"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-white/90">{list.name}</p>
                <p className="mt-1 text-xs text-white/50">{list.memberCount} 個字詞</p>
              </div>
              <button
                type="button"
                aria-label={`從「${list.name}」繼續`}
                disabled={empty || busy}
                onClick={() => void handleContinue(list)}
                className="self-start rounded-lg bg-brand/90 px-3 py-1.5 text-sm font-medium text-bg-body enabled:hover:bg-brand disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? '載入中…' : '繼續'}
              </button>
              {empty ? <p className="text-xs text-white/40">清單無字詞</p> : null}
            </li>
          );
        })}
      </ul>

      {remaining > 0 ? (
        <button
          type="button"
          onClick={onSeeMore}
          className="mt-4 rounded-lg px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/10"
        >
          查看更多 ({remaining})
        </button>
      ) : null}

      <div className="mt-8 flex items-center gap-3 text-xs text-white/40">
        <span className="h-px flex-1 bg-white/10" />
        或 開始新的分析
        <span className="h-px flex-1 bg-white/10" />
      </div>
    </section>
  );
}
