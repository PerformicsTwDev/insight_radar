import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { KeywordsMeta } from '../../api/keywords';
import { deserialize } from '../../lib/urlState';
import { KeywordsPagination } from './KeywordsPagination';

/**
 * TC-18 (FR-7, Design §6 C5): the pagination + sort footer. Offset mode shows
 * `meta.total` + page numbers; page size is clamped to `maxPageSize`; page/sort
 * changes write the shared URL search schema and drive the C5 keyset/offset
 * switch. Keyset mode shows next/prev (cursor) with no page numbers.
 */
function renderFooter(meta: KeywordsMeta, initialEntry = '/') {
  const rootRoute = createRootRoute({ validateSearch: deserialize });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <KeywordsPagination meta={meta} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

const meta = (over: Partial<KeywordsMeta> = {}): KeywordsMeta => ({
  total: 120,
  page: 1,
  pageSize: 25,
  cursor: 'NEXT',
  ...over,
});

describe('TC-18 · KeywordsPagination (footer: meta.total + pageSize clamp)', () => {
  describe('offset mode', () => {
    it('shows meta.total and disables 上一頁 on the first page', async () => {
      renderFooter(meta({ total: 120, page: 1 }));
      expect(await screen.findByText(/共\s*120\s*筆/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '上一頁' })).toBeDisabled();
    });

    it('clamps an over-max URL pageSize down to maxPageSize (TC-18)', async () => {
      // pageSize=500 in the URL must clamp to 100 → 1000/100 = 10 offset pages,
      // NOT 1000/500 = 2. Proves the request never asks for an un-capped page.
      renderFooter(meta({ total: 1000 }), '/?pageSize=500');
      const size = (await screen.findByLabelText('每頁筆數')) as HTMLSelectElement;
      expect(size.value).toBe('100');
      expect(screen.getByRole('button', { name: '第 10 頁' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '第 11 頁' })).not.toBeInTheDocument();
    });

    it('advances a page on 下一頁 (offset stays offset within the cap)', async () => {
      const router = renderFooter(meta({ total: 200, page: 2 }), '/?page=2');
      fireEvent.click(await screen.findByRole('button', { name: '下一頁' }));
      await waitFor(() => expect(router.state.location.search.page).toBe(3));
      expect(router.state.location.search.cursor).toBeUndefined();
    });

    it('steps back a page on 上一頁', async () => {
      const router = renderFooter(meta({ total: 200, page: 3 }), '/?page=3');
      fireEvent.click(await screen.findByRole('button', { name: '上一頁' }));
      await waitFor(() => expect(router.state.location.search.page).toBe(2));
    });

    it('jumps to a page number and marks the current page (aria-current)', async () => {
      const router = renderFooter(meta({ total: 200, page: 1 }), '/?page=1');
      expect(await screen.findByRole('button', { name: '第 1 頁' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByRole('button', { name: '第 2 頁' })).not.toHaveAttribute('aria-current');
      fireEvent.click(screen.getByRole('button', { name: '第 4 頁' }));
      await waitFor(() => expect(router.state.location.search.page).toBe(4));
      expect(router.state.location.search.cursor).toBeUndefined();
    });

    it('disables 下一頁 on the last (single) page', async () => {
      renderFooter(meta({ total: 25, page: 1 }), '/?page=1');
      expect(await screen.findByRole('button', { name: '下一頁' })).toBeDisabled();
    });
  });

  describe('sort + page-size controls reset to offset page 1', () => {
    it('changing the sort column writes sortBy and resets to page 1 (cursor dropped)', async () => {
      const router = renderFooter(meta({ total: 200, page: 3 }), '/?page=3&cursor=X');
      fireEvent.change(await screen.findByLabelText('排序欄位'), { target: { value: 'text' } });
      await waitFor(() => expect(router.state.location.search.sortBy).toBe('text'));
      expect(router.state.location.search.page).toBe(1);
      expect(router.state.location.search.cursor).toBeUndefined();
    });

    it('changing the sort direction writes sortDir', async () => {
      const router = renderFooter(meta({ total: 200, page: 1 }), '/?page=1');
      fireEvent.change(await screen.findByLabelText('排序方向'), { target: { value: 'asc' } });
      await waitFor(() => expect(router.state.location.search.sortDir).toBe('asc'));
    });

    it('changing the page size writes pageSize and resets to page 1', async () => {
      const router = renderFooter(meta({ total: 200, page: 3 }), '/?page=3');
      fireEvent.change(await screen.findByLabelText('每頁筆數'), { target: { value: '50' } });
      await waitFor(() => expect(router.state.location.search.pageSize).toBe(50));
      expect(router.state.location.search.page).toBe(1);
    });
  });

  describe('keyset mode', () => {
    it('renders the current page and follows meta.cursor on 下一頁; prev is disabled cold', async () => {
      const router = renderFooter(
        meta({ total: 5000, page: 41, cursor: 'CUR42' }),
        '/?page=41&cursor=CUR41',
      );
      expect(await screen.findByText(/第\s*41\s*頁/)).toBeInTheDocument();
      // No offset page-number buttons in keyset mode.
      expect(screen.queryByRole('button', { name: '第 1 頁' })).not.toBeInTheDocument();
      // Cold-loaded keyset link: no forward history yet → prev disabled.
      expect(screen.getByRole('button', { name: '上一頁' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
      await waitFor(() => expect(router.state.location.search.cursor).toBe('CUR42'));
      expect(router.state.location.search.page).toBe(42);
    });

    it('disables 下一頁 at the last keyset page (null cursor)', async () => {
      renderFooter(meta({ total: 5000, page: 200, cursor: null }), '/?page=200&cursor=LAST');
      expect(await screen.findByRole('button', { name: '下一頁' })).toBeDisabled();
    });
  });

  describe('C5 offset→keyset switch and back', () => {
    it('crosses to keyset past the cap on 下一頁, then 上一頁 re-enters offset', async () => {
      const router = renderFooter(meta({ total: 5000, page: 40, cursor: 'CUR41' }), '/?page=40');
      // At the cap (page 40) 下一頁 crosses into keyset seeded with the response cursor.
      fireEvent.click(await screen.findByRole('button', { name: '下一頁' }));
      await waitFor(() => expect(router.state.location.search.cursor).toBe('CUR41'));
      expect(router.state.location.search.page).toBe(41);
      // Now in keyset; forward history exists → prev enabled → falls back into offset (no cursor).
      fireEvent.click(screen.getByRole('button', { name: '上一頁' }));
      await waitFor(() => expect(router.state.location.search.cursor).toBeUndefined());
      expect(router.state.location.search.page).toBe(40);
    });
  });
});
