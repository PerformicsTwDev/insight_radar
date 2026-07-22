import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import type { ViewNavItem } from '../lib/viewRegistry';

/**
 * TC-37 — the left dimension menu is driven by view metadata (T3.1, FR-1 /
 * AC-1.2): one button per provided view (incl. a newly-registered one), the active
 * view marked with `aria-current`, and a degraded notice when the list is the
 * built-in fallback. AppShell stays presentational (Design §2) — it takes the
 * derived nav list as a prop; the fetch/fallback lives in `useViews`.
 */

const DIMS: readonly ViewNavItem[] = [
  {
    name: 'keywords',
    label: '搜尋詞總表',
    responseShape: 'table',
    requiresFeature: 'keyword_metrics',
  },
  // a view that is NOT hardcoded anywhere — proves the list is purely metadata-driven (AC-1.2).
  {
    name: 'intent_distribution',
    label: '意圖分佈',
    responseShape: 'chart',
    requiresFeature: 'keyword_metrics',
  },
];

describe('TC-37 · AppShell dimension menu (metadata-driven)', () => {
  it('renders one dimension button per provided view, including a newly-registered one (AC-1.2)', () => {
    render(<AppShell dimensions={DIMS}>content</AppShell>);
    const menu = screen.getByRole('navigation', { name: '維度選單' });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搜尋詞總表' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '意圖分佈' })).toBeInTheDocument();
  });

  it('marks the active view with aria-current="page"', () => {
    render(
      <AppShell dimensions={DIMS} activeView="intent_distribution">
        content
      </AppShell>,
    );
    expect(screen.getByRole('button', { name: '意圖分佈' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: '搜尋詞總表' })).not.toHaveAttribute('aria-current');
  });

  it('shows a degraded notice when the list is the built-in fallback (FR-1)', () => {
    render(
      <AppShell dimensions={DIMS} degraded>
        content
      </AppShell>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/內建|預設|無法載入/);
  });

  it('shows no degraded notice in the normal case', () => {
    render(<AppShell dimensions={DIMS}>content</AppShell>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('falls back to the built-in registry nav list when no dimensions are provided', () => {
    render(<AppShell>content</AppShell>);
    // FALLBACK_REGISTRY includes the keywords view.
    expect(screen.getByRole('button', { name: '搜尋詞總表' })).toBeInTheDocument();
  });

  it('leaves the dimension menu disabled when no onSelectView is provided', () => {
    render(<AppShell dimensions={DIMS}>content</AppShell>);
    expect(screen.getByRole('button', { name: '意圖分佈' })).toBeDisabled();
  });

  it('enables the dimension menu and reports the selected view when onSelectView is provided (T6.0)', () => {
    const onSelectView = vi.fn();
    render(
      <AppShell dimensions={DIMS} onSelectView={onSelectView}>
        content
      </AppShell>,
    );
    const button = screen.getByRole('button', { name: '意圖分佈' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onSelectView).toHaveBeenCalledWith('intent_distribution');
  });
});

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
    render(<AppShell dimensions={DIMS}>content</AppShell>);
    expect(screen.getByRole('navigation', { name: '主要分頁' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search Insight' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'AI Search Insight' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Social Insight' })).toBeInTheDocument();
  });

  it('AI Search Insight is a roadmap tab: not active, click surfaces 即將推出 without navigating', () => {
    render(<AppShell dimensions={DIMS}>content</AppShell>);
    const ai = screen.getByRole('button', { name: 'AI Search Insight' });
    expect(ai).not.toHaveAttribute('aria-current');
    // no notice before interaction (not drawn empty)
    expect(screen.queryByText('即將推出')).not.toBeInTheDocument();
    fireEvent.click(ai);
    expect(screen.getByRole('status')).toHaveTextContent('即將推出');
  });

  it('Social Insight is a roadmap tab and surfaces the same 即將推出 notice on click', () => {
    render(<AppShell dimensions={DIMS}>content</AppShell>);
    const social = screen.getByRole('button', { name: 'Social Insight' });
    expect(social).not.toHaveAttribute('aria-current');
    fireEvent.click(social);
    expect(screen.getByText('即將推出')).toBeInTheDocument();
  });
});
