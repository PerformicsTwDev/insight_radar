import { render, screen } from '@testing-library/react';
import App from './App';

// Shell render smoke (T1.1): App now mounts the TanStack Router shell, so assert
// the shell landmarks render — the brand heading, the active Search tab, the
// dimension menu, and the home outlet content. Router mount is async → findBy.
describe('App (shell render smoke)', () => {
  it('renders the app shell: brand heading, active Search Insight tab, dimension menu, home outlet', async () => {
    render(<App />);

    // Brand landmark (also asserted by the Playwright boot smoke).
    expect(await screen.findByRole('heading', { level: 1, name: /insight radar/i })).toBeVisible();

    // v4 nav (T7.1): only Search Insight is active; AI Search Insight / Social Insight
    // are roadmap tabs (not active, click → 即將推出).
    const searchTab = screen.getByRole('button', { name: 'Search Insight' });
    expect(searchTab).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'AI Search Insight' })).not.toHaveAttribute(
      'aria-current',
    );

    // v4 (T7.9): the left dimension menu is HIDDEN on the input screen (no analysis in
    // context); the top-nav 分析設定 control is present instead.
    expect(screen.queryByRole('navigation', { name: '維度選單' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分析設定' })).toBeInTheDocument();
    // The 分析歷史 entry (T3.5) points at the /history route.
    expect(screen.getByRole('link', { name: '分析歷史' })).toHaveAttribute('href', '/history');
    expect(await screen.findByRole('heading', { level: 2, name: '關鍵字分析' })).toBeVisible();
  });
});
