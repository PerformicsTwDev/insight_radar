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
    // v4 inline 語境列 (T7.8): `分析字詞：` + truncated preview as static text, then only the
    // brand-coloured `等 N 個字詞 ⓘ` is the clickable toggle → full seed-list tooltip.
    <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
      <span className="shrink-0 text-white/40">分析字詞：</span>
      <span className="max-w-[22rem] truncate text-white/80">{preview}</span>
      <span className="relative shrink-0">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 whitespace-nowrap text-brand transition hover:opacity-80"
        >
          等 {seeds.length} 個字詞
          <InfoIcon />
        </button>

        {open ? (
          <div
            role="dialog"
            aria-label="分析字詞"
            className="absolute left-0 top-[calc(100%+10px)] z-50 max-h-64 w-80 overflow-y-auto rounded-xl border border-white/10 bg-bg-body p-4 shadow-2xl"
          >
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-white/40">
              完整字詞清單（{seeds.length}）
            </p>
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
      </span>
    </div>
  );
}

/** Inline ⓘ affordance for the context-bar tooltip toggle (decorative; the button is labelled). */
function InfoIcon(): ReactElement {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}
