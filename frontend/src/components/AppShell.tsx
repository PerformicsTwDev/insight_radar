import { useState, type ReactNode } from 'react';
import { NavSettings } from './NavSettings';

/**
 * App shell (T1.1; M7-R17 v4 fidelity stage 1) — presentational, no router/API
 * dependency. Just the v4 three-line top-tab bar (T7.1, FR-1 / TC-58〔nav〕):
 * `Search Insight` is the active product area; `AI Search Insight` / `Social Insight`
 * are roadmap tabs (M8 T8.4 enables AI Search) — clicking one surfaces an ephemeral
 * 即將推出 notice and never navigates / 404s (the hint is internal state, so the shell
 * keeps zero router dependency). The analysis context bar (T7.8) fills a header slot.
 *
 * The prototype (`#view-results`) owns its own 3-column layout (分析維度 menu + centre
 * + AI 洞察 panel) inside the view, so the shell no longer renders a left dimension
 * menu — {@link ResultsLayout} does, in results context. The shell is a plain
 * page-scroll frame (`min-h-screen`): the results area's fixed `lg:h-[2000px]` grid
 * overflows into a normal page scroll (prototype behaviour). Colours come from the
 * `src/index.css` design tokens — no hardcoded hex (Design §6 / FR-14).
 */

export interface AppShellProps {
  readonly children: ReactNode;
  /**
   * Navigate the `Search Insight` tab back to the input screen (T7.9, `/`, clearing
   * the analysis context). Router-aware container supplies it; when omitted the tab
   * is a passive active-indicator (standalone shell render stays router-free).
   */
  readonly onNavigateHome?: () => void;
  /**
   * Optional right-aligned header slot (e.g. the 追蹤清單 / 分析歷史 entries, T3.5). A
   * container fills it with router-aware nodes; the presentational shell just renders it.
   */
  readonly headerExtra?: ReactNode;
  /**
   * Optional top-nav analysis context bar (T7.8): the analysis's 搜尋詞 preview + ⓘ popover.
   * A container supplies `<AnalysisContextBar>` only while an analysis is in view; the
   * component itself renders nothing when there is no snapshot, so on the cold screen this
   * slot is empty.
   */
  readonly contextBar?: ReactNode;
}

/**
 * v4 top-level product areas (TC-58〔nav〕). `Search Insight` is active; the two
 * `roadmap` tabs are not yet available (AI Search enables at M8 T8.4, Social is NG2)
 * — clicking one shows a 即將推出 notice instead of navigating.
 */
const TABS = [
  { id: 'search', label: 'Search Insight', roadmap: false },
  { id: 'ai', label: 'AI Search Insight', roadmap: true },
  { id: 'social', label: 'Social Insight', roadmap: true },
] as const;

const TAB_ACTIVE =
  'rounded-lg border border-brand/50 bg-brand/10 px-4 py-4 text-sm font-medium text-brand';
const TAB_ROADMAP = 'px-4 py-4 text-sm text-white/40 hover:text-white/60';

export function AppShell({ children, onNavigateHome, headerExtra, contextBar }: AppShellProps) {
  // Roadmap tabs (AI Search / Social) are not navigable yet: clicking one flips this
  // to show an ephemeral 即將推出 notice — never a route change / 404 (TC-58〔nav〕).
  const [roadmapHint, setRoadmapHint] = useState(false);
  return (
    // Page-scroll frame (M7-R17): the results area's fixed 2000px grid overflows into a
    // normal page scroll (prototype behaviour), not a viewport-tall clip.
    <div className="min-h-screen bg-bg-body text-white">
      <header className="border-b border-border-topbar bg-bg-card">
        {/* Wrap on narrow viewports so the right-side NavSettings / 登入·登出 controls stay
            reachable (M7-R13). No effect at desktop widths (nothing wraps). */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6">
          <h1 className="py-4 text-lg font-semibold text-brand">Insight Radar</h1>
          <nav aria-label="主要分頁" className="flex items-center gap-1">
            {TABS.map((tab) =>
              tab.roadmap ? (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRoadmapHint(true)}
                  className={TAB_ROADMAP}
                >
                  {tab.label}
                </button>
              ) : (
                // Search Insight — active indicator AND a link back to the input screen
                // (T7.9): clicking navigates home (`/`, clearing the analysis context).
                <button
                  key={tab.id}
                  type="button"
                  aria-current="page"
                  onClick={onNavigateHome}
                  className={TAB_ACTIVE}
                >
                  {tab.label}
                </button>
              ),
            )}
            {roadmapHint ? (
              <span role="status" className="ml-2 text-xs text-white/50">
                即將推出
              </span>
            ) : null}
          </nav>
          {/* Analysis context bar (T7.8) — only present while an analysis is in view. */}
          {contextBar}
          <div className="ml-auto flex items-center gap-2">
            <NavSettings />
            {headerExtra}
          </div>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
