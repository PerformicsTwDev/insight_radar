import { Outlet } from '@tanstack/react-router';
import { AppShell } from './AppShell';

/** Root route layout: the app shell wrapping the active route's outlet (T1.1). */
export function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
