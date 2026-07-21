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
