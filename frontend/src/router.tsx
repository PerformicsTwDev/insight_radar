import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { RootLayout } from './components/RootLayout';
import { HomeRoute } from './features/home/HomeRoute';
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

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

// Register the router instance for type-safe search params / navigation app-wide.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
