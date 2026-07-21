import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { RootLayout } from './components/RootLayout';
import { LoginRoute } from './features/auth/LoginRoute';
import { HistoryView } from './features/history/HistoryView';
import { HomeRoute } from './features/home/HomeRoute';
import { TrackingDetailRoute } from './features/tracking/TrackingDetailRoute';
import { TrackingListsRoute } from './features/tracking/TrackingListsRoute';
import { deserialize } from './lib/urlState';

/**
 * Code-based route tree (T1.1). We deliberately use `createRootRoute` /
 * `createRoute` / `createRouter` rather than file-based routing so there is no
 * generated `routeTree.gen.ts` to exclude from eslint / prettier / coverage.
 *
 * The root route owns the app-wide search schema via `validateSearch:
 * deserialize` (the pure `lib/urlState` codec) — type-safe, and an unknown
 * `view` / malformed `analysisId` in the URL normalises to a not-found
 * (undefined) state instead of crashing (Design §5 / FR-1 / TC-11).
 */
const rootRoute = createRootRoute({
  validateSearch: deserialize,
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeRoute,
});

// Login page (T1.4, FR-12). Reachable directly or via the global 401 redirect;
// the pending return URL is held in module state (see `useUnauthorizedRedirect`).
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginRoute,
});

// Analysis history (T3.5, FR-10). Its own path so it is reachable/shareable; a row
// reopen navigates back to `/` with the chosen `analysisId` (URL restore, FR-1).
const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/history',
  component: HistoryView,
});

// Tracking lists (T5.7, FR-19) — a cross-analysis GLOBAL resource, so it gets its own
// top-level entry (nav Link in RootLayout). `/tracking` is the management list; a row's
// 開啟 deep-links to `/tracking/$listId`, the list's volume time-series detail.
const trackingListsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tracking',
  component: TrackingListsRoute,
});

const trackingDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tracking/$listId',
  component: TrackingDetailRoute,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  historyRoute,
  trackingListsRoute,
  trackingDetailRoute,
]);

export const router = createRouter({ routeTree });

// Register the router instance for type-safe search params / navigation app-wide.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
