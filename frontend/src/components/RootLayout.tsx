import { Link, Outlet, useNavigate, useSearch } from '@tanstack/react-router';
import { useUnauthorizedRedirect } from '../features/auth/unauthorizedRedirect';
import { AnalysisContextBar } from '../features/dashboard/AnalysisContextBar';
import { AppShell } from './AppShell';

/**
 * Root route layout: the app shell wrapping the active route's outlet (T1.1).
 * Also wires the global 401 → /login redirect once, app-wide (T1.4, FR-12).
 *
 * The left 分析維度 menu + tracking-list nav no longer live in the shell (M7-R17 v4
 * fidelity): the results dashboard ({@link ResultsLayout}, rendered by
 * `AnalysisDashboard`) owns the whole 3-column frame — menu, filters, centre content
 * and AI 洞察 panel — so here we only feed the shell the top-nav slots: the analysis
 * 語境列 (T7.8), the 追蹤清單 / 分析歷史 header entries, and the Search-tab home nav (T7.9).
 */
export function RootLayout() {
  useUnauthorizedRedirect();
  const navigate = useNavigate();
  const analysisId = useSearch({ strict: false, select: (search) => search.analysisId });
  return (
    <AppShell
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
