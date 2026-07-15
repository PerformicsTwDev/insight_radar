import { render, screen } from '@testing-library/react';
import App from './App';

// Shell render smoke (T1.1): App now mounts the TanStack Router shell, so assert
// the shell landmarks render — the brand heading, the active Search tab, the
// dimension menu, and the home outlet content. Router mount is async → findBy.
describe('App (shell render smoke)', () => {
  it('renders the app shell: brand heading, active Search tab, dimension menu, home outlet', async () => {
    render(<App />);

    // Brand landmark (also asserted by the Playwright boot smoke).
    expect(await screen.findByRole('heading', { level: 1, name: /insight radar/i })).toBeVisible();

    // Only the Search tab is active; AI / Social are rendered disabled.
    const searchTab = screen.getByRole('button', { name: '搜尋分析' });
    expect(searchTab).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'AI 洞察' })).toBeDisabled();

    // Left dimension-menu shell + mounted home-route outlet content.
    expect(screen.getByRole('navigation', { name: '維度選單' })).toBeInTheDocument();
    // The 分析歷史 entry (T3.5) points at the /history route.
    expect(screen.getByRole('link', { name: '分析歷史' })).toHaveAttribute('href', '/history');
    expect(await screen.findByRole('heading', { level: 2, name: '關鍵字分析' })).toBeVisible();
  });
});
