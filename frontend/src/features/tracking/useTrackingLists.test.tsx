import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { useTrackingLists } from './useTrackingLists';

/**
 * TC-47 (hook; T5.7, FR-19) — the shared tracking-list read hook that backs the
 * top-level entry AND (future) the results-page sidebar. It owns the fetch
 * lifecycle (`lists` / `loading` / `failed` / `reload`) and exposes `setLists` so
 * a consumer can apply optimistic create/rename/delete without a refetch. All
 * egress is MSW-mocked (never the real backend).
 */

const LIST_ROUTE = '/api/v1/tracking-lists';

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

describe('TC-47 · useTrackingLists (shared list-data hook)', () => {
  it("loads the owner's lists on mount (loading → settled)", async () => {
    server.use(
      http.get(LIST_ROUTE, () =>
        HttpResponse.json([summary('l1', 'Running shoes', 3)], { status: 200 }),
      ),
    );
    const { result } = renderHook(() => useTrackingLists());

    expect(result.current.loading).toBe(true); // fetch is in-flight on first render
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lists.map((l) => l.name)).toEqual(['Running shoes']);
    expect(result.current.failed).toBe(false);
  });

  it('flags failed on a non-2xx (never throws, empty list)', async () => {
    server.use(http.get(LIST_ROUTE, () => new HttpResponse(null, { status: 500 })));
    const { result } = renderHook(() => useTrackingLists());

    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.lists).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('reload refetches the lists', async () => {
    let batch = [summary('l1', 'First', 1)];
    server.use(http.get(LIST_ROUTE, () => HttpResponse.json(batch, { status: 200 })));
    const { result } = renderHook(() => useTrackingLists());
    await waitFor(() => expect(result.current.lists.map((l) => l.name)).toEqual(['First']));

    batch = [summary('l1', 'First', 1), summary('l2', 'Second', 0)];
    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() =>
      expect(result.current.lists.map((l) => l.name)).toEqual(['First', 'Second']),
    );
  });

  it('setLists applies an optimistic local mutation (no refetch)', async () => {
    server.use(
      http.get(LIST_ROUTE, () => HttpResponse.json([summary('l1', 'First', 1)], { status: 200 })),
    );
    const { result } = renderHook(() => useTrackingLists());
    await waitFor(() => expect(result.current.lists).toHaveLength(1));

    act(() => {
      result.current.setLists((prev) => [...prev, summary('l2', 'Second', 0)]);
    });
    expect(result.current.lists.map((l) => l.name)).toEqual(['First', 'Second']);
  });
});
