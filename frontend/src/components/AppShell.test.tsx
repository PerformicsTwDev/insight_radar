import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

/**
 * AppShell is now the top nav only (M7-R17 v4 fidelity): the left 分析維度 menu +
 * tracking nav moved into `ResultsLayout` (see `ResultsLayout.test`). These specs cover
 * what the shell still owns — the v4 three-line top-tab state machine (TC-58〔nav〕), the
 * Search-tab home nav + 分析設定 control (TC-72), and the page-scroll frame (M7-R17).
 */

/**
 * TC-58〔nav 部分〕 — the v4 three-line top-tab state machine (T7.1, FR-1). Labels
 * align to v4 (`Search Insight` / `AI Search Insight` / `Social Insight`);
 * Search Insight is the active product area (`aria-current="page"`), while
 * AI Search Insight and Social Insight are roadmap-disabled — clicking one surfaces
 * an ephemeral 即將推出 notice (a11y live region) and NEVER navigates / 404s. The
 * shell stays presentational (Design §2): the roadmap hint is internal state, no
 * router dependency.
 */
describe('TC-58〔nav〕· v4 三線 top-tab 狀態機 (T7.1)', () => {
  it('renders the three v4 top tabs, with Search Insight active', () => {
    render(<AppShell>content</AppShell>);
    expect(screen.getByRole('navigation', { name: '主要分頁' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search Insight' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'AI Search Insight' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Social Insight' })).toBeInTheDocument();
  });

  it('AI Search Insight is a roadmap tab: not active, click surfaces 即將推出 without navigating', () => {
    render(<AppShell>content</AppShell>);
    const ai = screen.getByRole('button', { name: 'AI Search Insight' });
    expect(ai).not.toHaveAttribute('aria-current');
    // no notice before interaction (not drawn empty)
    expect(screen.queryByText('即將推出')).not.toBeInTheDocument();
    fireEvent.click(ai);
    expect(screen.getByRole('status')).toHaveTextContent('即將推出');
  });

  it('Social Insight is a roadmap tab and surfaces the same 即將推出 notice on click', () => {
    render(<AppShell>content</AppShell>);
    const social = screen.getByRole('button', { name: 'Social Insight' });
    expect(social).not.toHaveAttribute('aria-current');
    fireEvent.click(social);
    expect(screen.getByText('即將推出')).toBeInTheDocument();
  });
});

/**
 * TC-72 (T7.9, FR-1 修訂 / AC-1.3) — the Search Insight tab navigates back to the input
 * screen; the top-nav 分析設定 control is present.
 */
describe('TC-72 · Search-tab home nav + settings (T7.9)', () => {
  it('navigates home when the Search Insight tab is clicked', () => {
    const onNavigateHome = vi.fn();
    render(<AppShell onNavigateHome={onNavigateHome}>content</AppShell>);
    fireEvent.click(screen.getByRole('button', { name: 'Search Insight' }));
    expect(onNavigateHome).toHaveBeenCalledTimes(1);
  });

  it('renders the top-nav 分析設定 control', () => {
    render(<AppShell>content</AppShell>);
    expect(screen.getByRole('button', { name: '分析設定' })).toBeInTheDocument();
  });

  it('renders the header context-bar + extra slots when provided', () => {
    render(
      <AppShell contextBar={<div>分析字詞：跑鞋</div>} headerExtra={<button>分析歷史</button>}>
        content
      </AppShell>,
    );
    expect(screen.getByText('分析字詞：跑鞋')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分析歷史' })).toBeInTheDocument();
  });
});

/**
 * M7-R17 (v4 fidelity) — the shell is a plain page-scroll frame (`min-h-screen`, not the
 * old `h-screen overflow-hidden` clip): the results area's fixed `lg:h-[2000px]` grid
 * (owned by `ResultsLayout`) overflows into a normal page scroll (prototype behaviour).
 * The shell no longer renders a left dimension menu — that assertion lives in
 * `ResultsLayout.test`.
 */
describe('M7-R17 · AppShell page-scroll frame + header wrap', () => {
  it('is a page-scroll frame (min-h-screen, not a fixed-height overflow clip)', () => {
    const { container } = render(<AppShell>content</AppShell>);
    const frame = container.firstChild as HTMLElement;
    expect(frame.className).toContain('min-h-screen');
    expect(frame.className).not.toContain('overflow-hidden');
  });

  it('does not render the left 維度選單 (it moved into ResultsLayout)', () => {
    render(<AppShell>content</AppShell>);
    expect(screen.queryByRole('navigation', { name: '維度選單' })).not.toBeInTheDocument();
  });

  it('wraps the header row so its right-side controls stay reachable on narrow viewports (M7-R13)', () => {
    render(<AppShell>content</AppShell>);
    const headerRow = screen.getByRole('navigation', { name: '主要分頁' })
      .parentElement as HTMLElement;
    expect(headerRow.className).toContain('flex-wrap');
  });
});
