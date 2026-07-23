import { skipToken, useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import type { StatusFetch } from '../../api/keywordAnalyses';
import { config } from '../../config/env';
import { analysisStatusQueryKey } from './analysisStatusQuery';

/**
 * Top-nav analysis context bar (T7.8, FR-1 / AC-1.3, TC-56): while an analysis is in view,
 * it shows the analysis's original 搜尋詞 — a preview of the first
 * `VITE_CONTEXT_BAR_PREVIEW_N` seeds + the total count, with an ⓘ popover listing them all.
 *
 * It is a **pure subscriber** (§7): it reads the SAME `GET :id` status snapshot the
 * {@link AnalysisDashboard} already fetched — same {@link analysisStatusQueryKey}, with
 * `skipToken` so it never opens a second request. `seeds` comes from the snapshot
 * (`backend:AC-8.5`). No cached snapshot / empty seeds → renders nothing (cold open /
 * no context stays clean). Tokens only (no hardcoded hex).
 */
export function AnalysisContextBar({ analysisId }: { analysisId: string }): ReactElement | null {
  const [open, setOpen] = useState(false);
  const snapshot = useQuery<StatusFetch>({
    queryKey: analysisStatusQueryKey(analysisId),
    queryFn: skipToken,
  }).data;

  const seeds = snapshot?.kind === 'ok' ? (snapshot.status.seeds ?? []) : [];
  if (seeds.length === 0) return null;

  const preview = seeds.slice(0, config.contextBarPreviewN).join('、');

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ring-1 ring-white/10 hover:ring-white/20"
      >
        <span className="text-white/40">分析字詞：</span>
        <span className="max-w-[22rem] truncate text-white/80">{preview}</span>
        <span className="shrink-0 text-white/40">等 {seeds.length} 個字詞</span>
        <InfoIcon />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="分析字詞"
          className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-white/10 bg-bg-card p-4 shadow-xl"
        >
          <p className="mb-2 text-xs text-white/40">此分析的輸入搜尋詞（{seeds.length}）</p>
          <ul aria-label="分析字詞清單" className="flex flex-wrap gap-1.5">
            {seeds.map((seed) => (
              <li
                key={seed}
                className="rounded-md bg-bg-input px-2 py-1 text-xs text-white/80 ring-1 ring-white/10"
              >
                {seed}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Inline ⓘ affordance for the context-bar popover toggle (decorative; the button is labelled). */
function InfoIcon(): ReactElement {
  return (
    <svg className="h-4 w-4 text-white/40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}
