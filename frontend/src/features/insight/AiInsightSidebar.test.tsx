import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../api/msw/server';
import { AiInsightSidebar } from './AiInsightSidebar';

/**
 * TC-27 (FR-17 / AC-17.1) — the per-view AI 洞察 side panel. Reuses the view-gate
 * (`featureStatusOf`) for the not-ready placeholder, the C4 canonical filters
 * serialization (filter change → re-request), the shared clipboard shell for 複製,
 * and shows a clean error (never a half summary) on the LLM 502. The `ai-insight`
 * endpoint is mocked via MSW (external API always mocked, Design §2).
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ROUTE = '/api/v1/keyword-analyses/:id/ai-insight';
const INSIGHT = '導購型意圖為主，使用者多在比較品牌與價格。';
const OK_BODY = { view: 'keywords', insight: INSIGHT, generatedAt: '2026-07-21T00:00:00.000Z' };
/** A features map whose `keyword_metrics` gate is ready (view-gate reuse). */
const READY: unknown = { keyword_metrics: { status: 'ready' } };

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Register the ai-insight endpoint and record each request body it receives. */
function recordInsight(
  body: { view: string; insight: string; generatedAt: string } = OK_BODY,
): unknown[] {
  const calls: unknown[] = [];
  server.use(
    http.post(ROUTE, async ({ request }) => {
      calls.push(await request.json());
      return HttpResponse.json(body, { status: 200 });
    }),
  );
  return calls;
}

describe('TC-27 · AiInsightSidebar (per-view 洞察 + 篩選重取 + 複製 + gated + 失敗態)', () => {
  it('ready + open → POSTs :id/ai-insight { view, filters } and renders the scoped insight', async () => {
    const calls = recordInsight();

    render(
      <AiInsightSidebar
        analysisId={ID}
        view="keywords"
        filters={{ volumeMin: 100 }}
        requiresFeature="keyword_metrics"
        features={READY}
        scopeLabel="搜尋詞總表"
      />,
      { wrapper: wrapper() },
    );

    // In-flight → 生成中 status (covers the loading branch deterministically).
    expect(screen.getByRole('status')).toHaveTextContent(/洞察生成中/);

    await waitFor(() => expect(screen.getByText(INSIGHT)).toBeInTheDocument());
    expect(screen.getByText(/AI 數據洞察總結/)).toHaveTextContent('搜尋詞總表');
    expect(calls).toEqual([{ view: 'keywords', filters: { volumeMin: 100 } }]);
  });

  it('filters change → re-requests with the new (canonical) filters', async () => {
    const calls = recordInsight();

    const { rerender } = render(
      <AiInsightSidebar
        analysisId={ID}
        view="keywords"
        filters={{ volumeMin: 100 }}
        requiresFeature="keyword_metrics"
        features={READY}
      />,
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(calls.length).toBe(1));

    rerender(
      <AiInsightSidebar
        analysisId={ID}
        view="keywords"
        filters={{ volumeMin: 500 }}
        requiresFeature="keyword_metrics"
        features={READY}
      />,
    );
    await waitFor(() => expect(calls.length).toBe(2));

    expect(calls).toEqual([
      { view: 'keywords', filters: { volumeMin: 100 } },
      { view: 'keywords', filters: { volumeMin: 500 } },
    ]);
  });

  it('複製 writes the insight text to the clipboard and shows ✓', async () => {
    recordInsight({
      view: 'keywords',
      insight: 'COPY-ME insight',
      generatedAt: OK_BODY.generatedAt,
    });

    render(
      <AiInsightSidebar
        analysisId={ID}
        view="keywords"
        filters={{}}
        requiresFeature="keyword_metrics"
        features={READY}
      />,
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(screen.getByText('COPY-ME insight')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /複製/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('COPY-ME insight'));
    expect(await screen.findByText('✓ 已複製')).toBeInTheDocument();
  });

  it('gated (view feature not ready) → shows the placeholder and does NOT POST', async () => {
    let posted = false;
    server.use(
      http.post(ROUTE, () => {
        posted = true;
        return HttpResponse.json(OK_BODY, { status: 200 });
      }),
    );

    render(
      <AiInsightSidebar
        analysisId={ID}
        view="journey"
        filters={{}}
        requiresFeature="topics"
        features={{ topics: { status: 'not_generated' } }}
      />,
      { wrapper: wrapper() },
    );

    expect(
      screen.getByText('完成此分析後，AI 會依目前頁面的表格與圖表產生對應洞察'),
    ).toBeInTheDocument();
    // A disabled query never runs — flush a microtask and confirm no request fired.
    await Promise.resolve();
    expect(posted).toBe(false);
  });

  it('LLM failure (502) → shows the error state and NOT a half summary', async () => {
    server.use(http.post(ROUTE, () => new HttpResponse(null, { status: 502 })));

    render(
      <AiInsightSidebar
        analysisId={ID}
        view="keywords"
        filters={{}}
        requiresFeature="keyword_metrics"
        features={READY}
      />,
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/生成失敗/));
    // No insight, no copy button — the error must not render a partial summary.
    expect(screen.queryByText(INSIGHT)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /複製/ })).not.toBeInTheDocument();
  });

  it('collapsible: default collapsed → no fetch; toggle expands (aria-expanded) then re-collapses to hide the panel (水平 wipe)', async () => {
    const calls = recordInsight();

    render(
      <AiInsightSidebar
        analysisId={ID}
        view="keywords"
        filters={{}}
        requiresFeature="keyword_metrics"
        features={READY}
        defaultCollapsed
      />,
      { wrapper: wrapper() },
    );

    // Collapsed: only the toggle rail — no heading, no insight, no request.
    const toggle = screen.getByRole('button', { name: /AI 洞察側欄/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/AI 數據洞察總結/)).not.toBeInTheDocument();
    await Promise.resolve();
    expect(calls.length).toBe(0);

    // Expand → POST + insight.
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText(INSIGHT)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /AI 洞察側欄/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(calls.length).toBe(1);

    // Collapse again → the panel content is wiped away.
    fireEvent.click(screen.getByRole('button', { name: /AI 洞察側欄/ }));
    await waitFor(() => expect(screen.queryByText(INSIGHT)).not.toBeInTheDocument());
  });
});
