import type { ReactElement } from 'react';

/**
 * Dashboard routing state displays (T6.0, FR-1). Small presentational pieces the
 * view-content router falls back to when there is no view content to show, kept
 * distinct so each conveys the RIGHT thing (never a blank page / crash): an
 * unknown view is not the same as a known-but-unbuilt view, which is not the same
 * as a gone analysis. Tokens only — no hardcoded hex.
 */

const PANEL =
  'flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-bg-card p-8 text-center';

/**
 * The FR-1 boundary: a syntactically valid but unknown `view` param (registry says
 * it does not exist) resolves here — an explicit, non-blank not-found, never a
 * blank page. Names the offending view and points the user back to the menu.
 */
export function ViewNotFound({ view }: { view: string }): ReactElement {
  return (
    <section role="status" aria-label="找不到視圖" className={PANEL}>
      <p className="text-sm font-semibold text-white/70">找不到視圖「{view}」</p>
      <p className="text-xs text-white/50">此視圖不存在，請從左側選單選擇一個視圖。</p>
    </section>
  );
}

/**
 * A KNOWN registry view that has no bespoke dashboard component yet (e.g. the
 * chart-shape `intent_distribution` / `cpc_histogram`, or the serp-gated
 * `serp_questions`). Distinct from {@link ViewNotFound} — the view is real, the
 * dashboard just does not render it yet — so it is not the FR-1 unknown-view case.
 */
export function UnavailableView({ label }: { view: string; label: string }): ReactElement {
  return (
    <section role="status" aria-label="視圖尚未支援" className={PANEL}>
      <p className="text-sm text-white/60">「{label}」視圖尚未在儀表板支援。</p>
    </section>
  );
}

/**
 * The authoritative `GET :id` reports the analysis is gone (404 — deleted /
 * expired / not the caller's; FR-3 boundary). Explicit not-found rather than a
 * frozen "分析進行中".
 */
export function AnalysisNotFound(): ReactElement {
  return (
    <section role="status" aria-label="找不到分析" className={PANEL}>
      <p className="text-sm font-semibold text-white/70">找不到分析</p>
      <p className="text-xs text-white/50">此分析不存在或已失效，請重新建立。</p>
    </section>
  );
}
