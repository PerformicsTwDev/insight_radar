import { useState, type ReactNode } from 'react';
import { FALLBACK_REGISTRY, type ViewNavItem } from '../lib/viewRegistry';

/**
 * App shell layout (T1.1) — presentational only, no router/API dependency.
 * v4 three-line top-tab bar (T7.1, FR-1 / TC-58〔nav〕): `Search Insight` is the
 * active product area; `AI Search Insight` / `Social Insight` are roadmap tabs
 * (M8 T8.4 enables AI Search) — clicking a roadmap tab surfaces an ephemeral
 * 即將推出 notice and never navigates / 404s (the hint is internal state, so the
 * shell keeps zero router dependency). Plus a left dimension menu (T3.1: driven by
 * `GET /views` metadata, passed in as `dimensions`; the fetch/fallback lives in
 * `useViews`) + a main content slot. All colours come from the design tokens in
 * `src/index.css` (Tailwind utilities / `var(--color-*)`) — no hardcoded hex
 * (single-source rule, Design §6 / FR-14).
 */

export interface AppShellProps {
  readonly children: ReactNode;
  /** Left dimension-menu items, derived from view metadata (T3.1, AC-1.2). */
  readonly dimensions?: readonly ViewNavItem[];
  /** The currently-selected `view` (URL state); marked with `aria-current`. */
  readonly activeView?: string;
  /** True when `dimensions` is the built-in fallback (`GET /views` failed) → show a notice (FR-1). */
  readonly degraded?: boolean;
  /**
   * Select a dimension → switch the active `view` (T6.0, FR-1). When provided the
   * left menu is interactive (a router-aware container maps it to a URL `view`
   * navigation); when omitted (no analysis in view, or a standalone shell render)
   * the menu stays disabled — clicking a dimension with nothing to show is a no-op.
   */
  readonly onSelectView?: (view: string) => void;
  /**
   * Optional right-aligned header slot (e.g. the 分析歷史 entry, T3.5). A container
   * fills it with router-aware nodes; the presentational shell just renders it, so
   * standalone shell renders stay router-free.
   */
  readonly headerExtra?: ReactNode;
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

export function AppShell({
  children,
  dimensions = FALLBACK_REGISTRY.navItems,
  activeView,
  degraded = false,
  onSelectView,
  headerExtra,
}: AppShellProps) {
  // Roadmap tabs (AI Search / Social) are not navigable yet: clicking one flips this
  // to show an ephemeral 即將推出 notice — never a route change / 404 (TC-58〔nav〕).
  const [roadmapHint, setRoadmapHint] = useState(false);
  return (
    <div className="min-h-screen bg-bg-body text-white">
      <header className="border-b border-border-topbar bg-bg-card">
        <div className="flex items-center gap-6 px-6">
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
                <button key={tab.id} type="button" aria-current="page" className={TAB_ACTIVE}>
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
          {headerExtra ? <div className="ml-auto">{headerExtra}</div> : null}
        </div>
      </header>
      <div className="flex">
        <nav aria-label="維度選單" className="w-56 shrink-0 border-r border-white/10 p-3">
          {degraded ? (
            <p role="status" className="mb-2 rounded-md bg-white/5 px-3 py-2 text-xs text-white/50">
              無法載入視圖清單，改用內建預設
            </p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {dimensions.map((dim) => {
              const isActive = dim.name === activeView;
              const interactive = onSelectView !== undefined;
              return (
                <li key={dim.name}>
                  <button
                    type="button"
                    disabled={!interactive}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={interactive ? () => onSelectView(dim.name) : undefined}
                    className={
                      isActive
                        ? 'w-full rounded-lg bg-white/10 px-3 py-2 text-left text-sm text-white'
                        : interactive
                          ? 'w-full rounded-lg px-3 py-2 text-left text-sm text-white/70 hover:bg-white/5 hover:text-white'
                          : 'w-full cursor-not-allowed rounded-lg px-3 py-2 text-left text-sm text-white/40'
                    }
                  >
                    {dim.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
