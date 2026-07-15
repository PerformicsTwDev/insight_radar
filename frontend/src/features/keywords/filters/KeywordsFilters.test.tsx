import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { serializeFiltersToUrl } from '../../../lib/filterSpec';
import { deserialize } from '../../../lib/urlState';
import { KeywordsFilters } from './KeywordsFilters';

/**
 * TC-17 (URL sync, real router): the container binds the FilterBar to the URL
 * `filters` search param through the single codec + urlState. Applying a chip
 * writes the serialized FilterSpec into the URL; clearing removes the param.
 */

function renderInRouter(initialEntry = '/') {
  const rootRoute = createRootRoute({ validateSearch: deserialize });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: KeywordsFilters,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('TC-17 · KeywordsFilters (router-bound URL sync)', () => {
  it('writes the serialized FilterSpec into the URL filters param on apply', async () => {
    const router = renderInRouter();
    const chip = await screen.findByRole('button', { name: /搜尋詞/ });
    fireEvent.click(chip);
    const pop = within(screen.getByRole('group', { name: '搜尋詞 篩選' }));
    fireEvent.change(pop.getByLabelText('包含'), { target: { value: '吸塵器' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    await waitFor(() =>
      expect(router.state.location.search.filters).toBe(serializeFiltersToUrl({ q: '吸塵器' })),
    );
  });

  it('drives the chip from the URL state and clears the param on 清除全部', async () => {
    const router = renderInRouter();
    const chip = await screen.findByRole('button', { name: /搜尋詞/ });
    fireEvent.click(chip);
    const pop = within(screen.getByRole('group', { name: '搜尋詞 篩選' }));
    fireEvent.change(pop.getByLabelText('包含'), { target: { value: 'shoe' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    // The container holds no local state — the chip label is derived from the URL
    // `filters` param, so seeing 含 shoe proves the read path (URL → FilterSpec).
    expect(await screen.findByRole('button', { name: /含 shoe/ })).toBeInTheDocument();
    expect(router.state.location.search.filters).toBe(serializeFiltersToUrl({ q: 'shoe' }));

    fireEvent.click(screen.getByRole('button', { name: '清除全部' }));
    await waitFor(() => expect(router.state.location.search.filters).toBeUndefined());
  });

  it('resets pagination (drops page + cursor) on a filter change (C5 — stale cursor)', async () => {
    // Start deep-paged in keyset mode; a filter change must not carry the stale cursor.
    const router = renderInRouter('/?page=45&cursor=abc');
    expect(router.state.location.search.page).toBe(45);
    expect(router.state.location.search.cursor).toBe('abc');

    const chip = await screen.findByRole('button', { name: /搜尋詞/ });
    fireEvent.click(chip);
    const pop = within(screen.getByRole('group', { name: '搜尋詞 篩選' }));
    fireEvent.change(pop.getByLabelText('包含'), { target: { value: 'x' } });
    fireEvent.click(pop.getByRole('button', { name: '套用' }));

    await waitFor(() =>
      expect(router.state.location.search.filters).toBe(serializeFiltersToUrl({ q: 'x' })),
    );
    // C5: the old page position + the cursor minted against the old row set are gone.
    expect(router.state.location.search.page).toBeUndefined();
    expect(router.state.location.search.cursor).toBeUndefined();
  });
});
