import type { ReactNode } from 'react';

/**
 * App shell layout (T1.1) — presentational only, no router/API dependency.
 * Top-tab bar (only **Search** active; AI / Social rendered disabled per Design)
 * + a left dimension-menu placeholder + a main content slot. All colours come
 * from the design tokens in `src/index.css` (Tailwind utilities / `var(--color-*)`)
 * — no hardcoded hex (single-source rule, Design §6 / FR-14). Real navigation and
 * views arrive in T1.2+.
 */

/** Top-level product areas. Only Search is active for the shell; the rest are disabled. */
const TABS = [
  { id: 'search', label: '搜尋分析', active: true },
  { id: 'ai', label: 'AI 洞察', active: false },
  { id: 'social', label: '社群', active: false },
] as const;

/** Left dimension-menu placeholders (mirror the known dashboard views; inert until T2+). */
const DIMENSIONS = [
  { id: 'keywords', label: '搜尋詞總表' },
  { id: 'trend', label: '搜尋趨勢' },
  { id: 'intent', label: '意圖主題' },
  { id: 'journey', label: '購買歷程' },
  { id: 'history', label: '分析歷史' },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-body text-white">
      <header className="border-b border-border-topbar bg-bg-card">
        <div className="flex items-center gap-6 px-6">
          <h1 className="py-4 text-lg font-semibold text-brand">Insight Radar</h1>
          <nav aria-label="主要分頁" className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-current={tab.active ? 'page' : undefined}
                disabled={!tab.active}
                className={
                  tab.active
                    ? 'border-b-2 border-brand px-4 py-4 text-sm font-medium text-white'
                    : 'cursor-not-allowed px-4 py-4 text-sm text-white/30'
                }
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <div className="flex">
        <nav aria-label="維度選單" className="w-56 shrink-0 border-r border-white/10 p-3">
          <ul className="flex flex-col gap-1">
            {DIMENSIONS.map((dim) => (
              <li key={dim.id}>
                <button
                  type="button"
                  disabled
                  className="w-full cursor-not-allowed rounded-lg px-3 py-2 text-left text-sm text-white/40"
                >
                  {dim.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
