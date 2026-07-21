import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from './api/msw/server';
import { routeTree } from './router';

/**
 * TC-47 (routing/component; T5.7, FR-19) — the tracking list is a cross-analysis
 * GLOBAL resource, so it gets a top-level nav entry + its own routes. Mounts the
 * REAL app route tree in a memory-history router (so the assertions exercise the
 * shipped route config, nav wiring and param threading — not a copy): `/tracking`
 * → TrackingListsView, `/tracking/$listId` → TrackingDetailView (listId threaded
 * to the series egress), and a row's 開啟 → the detail route. All egress MSW-mocked.
 */

const LIST_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const LIST_ROUTE = '/api/v1/tracking-lists';
const SERIES_ROUTE = '/api/v1/tracking-lists/:listId/series';

function summary(listId: string, name: string, memberCount = 0) {
  return {
    listId,
    name,
    geo: 'TW',
    language: 'zh-TW',
    createdAt: '2026-07-21T00:00:00.000Z',
    memberCount,
  };
}

/** Empty-axis series → the AC-30.3 first-run empty state ("尚無時序資料"). */
function emptySeries(listId: string) {
  return {
    list: { listId, name: 'Running shoes', geo: 'TW', language: 'zh-TW' },
    axis: [],
    total: [],
    members: [],
    summary: { memberCount: 0, latestFetchedAt: null },
  };
}

function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('TC-47 · top-level tracking route + nav entry', () => {
  it('exposes a 追蹤清單 top-level nav entry in the app shell', async () => {
    server.use(http.get(LIST_ROUTE, () => HttpResponse.json([], { status: 200 })));
    renderAt('/tracking');
    expect(await screen.findByRole('link', { name: '追蹤清單' })).toBeInTheDocument();
  });

  it('mounts TrackingListsView at /tracking', async () => {
    server.use(
      http.get(LIST_ROUTE, () =>
        HttpResponse.json([summary(LIST_ID, 'Running shoes', 2)], { status: 200 }),
      ),
    );
    renderAt('/tracking');
    expect(await screen.findByRole('heading', { name: '建立追蹤清單' })).toBeInTheDocument();
    expect(await screen.findByText('Running shoes')).toBeInTheDocument();
  });

  it('navigates to /tracking when the nav entry is clicked', async () => {
    server.use(http.get(LIST_ROUTE, () => HttpResponse.json([], { status: 200 })));
    const router = renderAt('/');

    fireEvent.click(await screen.findByRole('link', { name: '追蹤清單' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/tracking'));
    expect(await screen.findByRole('heading', { name: '建立追蹤清單' })).toBeInTheDocument();
  });

  it('mounts TrackingDetailView at /tracking/$listId with the listId threaded to the series egress', async () => {
    let seenListId: string | undefined;
    server.use(
      http.get(SERIES_ROUTE, ({ params }) => {
        seenListId = params.listId as string;
        return HttpResponse.json(emptySeries(params.listId as string), { status: 200 });
      }),
    );
    renderAt(`/tracking/${LIST_ID}`);

    expect(await screen.findByText('尚無時序資料')).toBeInTheDocument();
    expect(seenListId).toBe(LIST_ID);
  });

  it('opens a list detail from a row (開啟 → /tracking/$listId)', async () => {
    server.use(
      http.get(LIST_ROUTE, () =>
        HttpResponse.json([summary(LIST_ID, 'Running shoes', 2)], { status: 200 }),
      ),
      http.get(SERIES_ROUTE, ({ params }) =>
        HttpResponse.json(emptySeries(params.listId as string), { status: 200 }),
      ),
    );
    const router = renderAt('/tracking');

    fireEvent.click(await screen.findByRole('button', { name: '開啟 Running shoes' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/tracking/${LIST_ID}`));
    expect(await screen.findByText('尚無時序資料')).toBeInTheDocument();
  });
});
