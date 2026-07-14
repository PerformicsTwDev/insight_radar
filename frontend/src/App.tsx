import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';

/**
 * App root: mounts the TanStack Router shell (T1.1) inside a TanStack Query
 * provider (T1.3 — first server-state use: job tracking reads/polls + cache).
 * Route tree, app-shell layout and the URL-is-state search schema live in
 * `src/router.tsx` / `src/lib/urlState.ts`.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
