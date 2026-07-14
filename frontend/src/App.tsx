import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';

/**
 * App root: mounts the TanStack Router shell (T1.1). Route tree, app-shell
 * layout and the URL-is-state search schema live in `src/router.tsx` /
 * `src/lib/urlState.ts`.
 */
export default function App() {
  return <RouterProvider router={router} />;
}
