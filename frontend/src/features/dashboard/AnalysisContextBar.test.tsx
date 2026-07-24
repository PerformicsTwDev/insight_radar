import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AnalysisContextBar } from './AnalysisContextBar';
import { analysisStatusQueryKey } from './analysisStatusQuery';

const ID = 'analysis-1';
const SEEDS = ['吸塵器', '掃地機器人', '除濕機', '空氣清淨機'];

/** Render the bar with the shared status snapshot pre-seeded into the query cache. */
function renderBar(cached: { seeds?: string[] } | null): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached !== null) {
    queryClient.setQueryData(analysisStatusQueryKey(ID), {
      kind: 'ok',
      status: { status: 'running', seeds: cached.seeds },
    });
  }
  return (
    <QueryClientProvider client={queryClient}>
      <AnalysisContextBar analysisId={ID} />
    </QueryClientProvider>
  );
}

describe('TC-56 · AnalysisContextBar (top-nav analysis context bar)', () => {
  it('shows a seeds preview (first VITE_CONTEXT_BAR_PREVIEW_N=3) + total count from the shared snapshot', () => {
    render(renderBar({ seeds: SEEDS }));
    // v4: preview = first 3 seeds (、-joined) as static inline text; total count on the toggle.
    expect(screen.getByText('吸塵器、掃地機器人、除濕機')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /個字詞/ })).toHaveTextContent('4 個字詞');
    // The 4th seed is NOT in the collapsed preview (only the tooltip reveals it).
    expect(screen.queryByText('空氣清淨機')).not.toBeInTheDocument();
  });

  it('reveals ALL seeds in a tooltip on click (ⓘ)', () => {
    render(renderBar({ seeds: SEEDS }));
    fireEvent.click(screen.getByRole('button', { name: /個字詞/ }));
    const list = screen.getByRole('list', { name: '分析字詞清單' });
    for (const seed of SEEDS) expect(list).toHaveTextContent(seed);
  });

  it('renders nothing when there is no cached snapshot (cold open / no analysis context)', () => {
    const { container } = render(renderBar(null));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the analysis has empty seeds', () => {
    const { container } = render(renderBar({ seeds: [] }));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the snapshot omits seeds (pre-#741 backend / optional field)', () => {
    const { container } = render(renderBar({})); // ok snapshot, seeds undefined
    expect(container).toBeEmptyDOMElement();
  });

  it('is a pure subscriber — reads cache only, never opens a second request', () => {
    // With no cached snapshot AND skipToken semantics, nothing is fetched (no queryFn runs).
    const { container } = render(renderBar(null));
    expect(container).toBeEmptyDOMElement();
  });
});
