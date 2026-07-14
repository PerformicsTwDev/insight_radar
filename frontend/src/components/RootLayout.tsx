import { Outlet } from '@tanstack/react-router';
import { useUnauthorizedRedirect } from '../features/auth/unauthorizedRedirect';
import { AppShell } from './AppShell';

/**
 * Root route layout: the app shell wrapping the active route's outlet (T1.1).
 * Also wires the global 401 → /login redirect once, app-wide (T1.4, FR-12).
 */
export function RootLayout() {
  useUnauthorizedRedirect();
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
