import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { CustomClassifyTable } from './CustomClassifyTable';

/**
 * TC-42 (part) — the custom-classification 分類表 reads `POST /query
 * {view:'custom:{cid}'}` (view-router; custom has no dedicated content endpoint) and
 * renders the returned columns + rows **metadata-driven** (columns come from the
 * response, not hard-coded) — the T3.1 registry integration point. A non-table body,
 * an empty row set, or a fetch failure all fall back to the empty state (never a
 * half-parsed table). Numbers group (— for null, C12), arrays join, missing → —.
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const CID = 'c1f2504e-0000-41d3-9a0c-0305e82c3301';

const TABLE = {
  view: `custom:${CID}`,
  columns: [
    { key: 'text', label: '關鍵字', type: 'text' },
    { key: 'label', label: '分類', type: 'text' },
    { key: 'avgMonthlySearches', label: '月均搜量', type: 'number' },
    { key: 'tags', label: '標籤', type: 'array' },
  ],
  rows: [
    { text: 'iphone 16', label: '價格導向', avgMonthlySearches: 12000, tags: ['3c', '手機'] },
    // Second row exercises the null/missing coercions: null number, null array, and a
    // non-string text cell (backend drift) — all → — (C12), never a crash.
    { text: null, label: '品質導向', avgMonthlySearches: null, tags: null },
  ],
  pagination: { total: 2, page: 1, pageSize: 25, cursor: null },
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderTable() {
  render(<CustomClassifyTable analysisId={ID} cid={CID} />, { wrapper: wrapper() });
}

describe('TC-42 · CustomClassifyTable', () => {
  it('sends {view:"custom:{cid}"} and renders the response columns + rows', async () => {
    let sentView: unknown;
    server.use(
      http.post('/api/v1/keyword-analyses/:id/query', async ({ request }) => {
        sentView = ((await request.json()) as { view?: unknown }).view;
        return HttpResponse.json(TABLE);
      }),
    );
    renderTable();

    await waitFor(() => expect(screen.getByText('iphone 16')).toBeInTheDocument());
    expect(sentView).toBe(`custom:${CID}`);
    // Dynamic (metadata-driven) headers.
    expect(screen.getByText('關鍵字')).toBeInTheDocument();
    expect(screen.getByText('分類')).toBeInTheDocument();
    // number grouped; array joined; null number / null array → — (C12).
    expect(screen.getByText('12,000')).toBeInTheDocument();
    expect(screen.getByText('3c, 手機')).toBeInTheDocument();
    expect(screen.getByText('品質導向')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the empty state when the query returns no rows', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses/:id/query', () =>
        HttpResponse.json({
          ...TABLE,
          rows: [],
          pagination: { total: 0, page: 1, pageSize: 25, cursor: null },
        }),
      ),
    );
    renderTable();
    await waitFor(() => expect(screen.getByText(/尚無分類資料/)).toBeInTheDocument());
  });

  it('shows the empty state when /query returns a non-table shape (defensive)', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses/:id/query', () =>
        HttpResponse.json({ view: `custom:${CID}`, axis: [], total: [], series: [] }),
      ),
    );
    renderTable();
    await waitFor(() => expect(screen.getByText(/尚無分類資料/)).toBeInTheDocument());
  });

  it('shows the empty state when /query fails (no crash)', async () => {
    server.use(
      http.post(
        '/api/v1/keyword-analyses/:id/query',
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    renderTable();
    await waitFor(() => expect(screen.getByText(/尚無分類資料/)).toBeInTheDocument());
  });
});
