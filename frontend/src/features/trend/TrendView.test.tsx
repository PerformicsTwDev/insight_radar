import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../api/msw/server';
import { TrendView } from './TrendView';

/**
 * TC-16 wiring (FR-5) — the trend-chart container. Fetches
 * `POST :id/query {view:'trend'}` and feeds the presentational {@link TrendChart}
 * the backend `axis` + `total` aggregate line (C10 — the frontend never re-derives
 * months). jsdom cannot render canvas, so Chart.js is mocked and we assert the
 * chart surface / states render. Egress MSW-mocked; no router dependency.
 */

vi.mock('chart.js', () => {
  class Chart {
    static register(): void {}
    destroy(): void {}
  }
  return { Chart, registerables: [] };
});

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const QUERY_ROUTE = '/api/v1/keyword-analyses/:id/query';

function renderTrend() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TrendView analysisId={ANALYSIS_ID} />
    </QueryClientProvider>,
  );
}

describe('TrendView · trend chart data wiring', () => {
  it('renders the trend chart from the /query {view:trend} axis + total', async () => {
    server.use(
      http.post(QUERY_ROUTE, () =>
        HttpResponse.json({
          view: 'trend',
          axis: ['2026-01', '2026-02', '2026-03'],
          total: [100, 120, 140],
          series: [],
        }),
      ),
    );
    renderTrend();
    expect(await screen.findByRole('img', { name: '搜尋趨勢折線圖' })).toBeInTheDocument();
  });

  it('shows an error + retry when the trend query fails, and recovers on retry', async () => {
    let calls = 0;
    server.use(
      http.post(QUERY_ROUTE, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ view: 'trend', axis: ['2026-01'], total: [10], series: [] });
      }),
    );
    renderTrend();
    fireEvent.click(await screen.findByRole('button', { name: '重試' }));
    expect(await screen.findByRole('img', { name: '搜尋趨勢折線圖' })).toBeInTheDocument();
  });
});
