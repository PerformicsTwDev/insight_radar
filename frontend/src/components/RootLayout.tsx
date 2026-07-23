import { Link, Outlet, useNavigate, useSearch } from '@tanstack/react-router';
import { useUnauthorizedRedirect } from '../features/auth/unauthorizedRedirect';
import { AnalysisContextBar } from '../features/dashboard/AnalysisContextBar';
import { useViews } from '../features/views/useViews';
import { AppShell } from './AppShell';

/**
 * Root route layout: the app shell wrapping the active route's outlet (T1.1).
 * Also wires the global 401 → /login redirect once, app-wide (T1.4, FR-12), and
 * drives the left dimension menu from `GET /views` metadata (T3.1, FR-1 / AC-1.2)
 * — a new backend view surfaces with no shared-component change; a `/views`
 * failure degrades to the built-in list with a notice.
 */
export function RootLayout() {
  useUnauthorizedRedirect();
  const navigate = useNavigate();
  const { registry, degraded } = useViews();
  const analysisId = useSearch({ strict: false, select: (search) => search.analysisId });
  const activeView = useSearch({ strict: false, select: (search) => search.view });
  // The dimension menu is interactive only when an analysis is in view: selecting a
  // dimension navigates to `/` with the chosen `view` (URL is state, Design §5), which
  // re-resolves the dashboard content (T6.0). Switching view starts a fresh page (the
  // old page/cursor belong to the previous view's row set); filters carry over.
  const onSelectView = analysisId
    ? (view: string) =>
        void navigate({
          to: '/',
          search: (prev) => ({ ...prev, view, page: undefined, cursor: undefined }),
        })
    : undefined;
  return (
    <AppShell
      dimensions={registry.navItems}
      activeView={activeView}
      // The "無法載入視圖清單" fallback notice is a views-loading error — only meaningful
      // while an analysis is in context (T7.5, TC-60). On a cold open the left menu is
      // disabled and there is nothing to view, so a `GET /views` failure must not paint
      // that misleading error; surface it only once an `analysisId` is present.
      degraded={degraded && analysisId !== undefined}
      onSelectView={onSelectView}
      // Results context (T7.9, AC-1.3): the left dimension menu shows only while an
      // analysis is in view. On the input / cold screen it is hidden entirely.
      hasAnalysisContext={analysisId !== undefined}
      // Search Insight tab → back to the input screen: clear the analysis context (and
      // per-view URL state) so a fresh analysis can be started (T7.9).
      onNavigateHome={() => void navigate({ to: '/', search: {} })}
      // Top-nav analysis context bar (T7.8): only while an analysis is in view — a pure
      // subscriber to the dashboard's `GET :id` snapshot (no extra request).
      contextBar={
        analysisId !== undefined ? <AnalysisContextBar analysisId={analysisId} /> : undefined
      }
      headerExtra={
        <div className="flex items-center gap-2">
          <Link
            to="/tracking"
            className="rounded-lg px-3 py-1.5 text-sm text-white/70 ring-1 ring-white/10 hover:text-white hover:ring-white/20"
          >
            追蹤清單
          </Link>
          <Link
            to="/history"
            className="rounded-lg px-3 py-1.5 text-sm text-white/70 ring-1 ring-white/10 hover:text-white hover:ring-white/20"
          >
            分析歷史
          </Link>
        </div>
      }
    >
      <Outlet />
    </AppShell>
  );
}
