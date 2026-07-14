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

  it('hydrates chips from an existing filters param and clears it on 清除全部', async () => {
    const filters = serializeFiltersToUrl({ q: 'shoe', volumeMin: 100 });
    const router = renderInRouter(`/?filters=${encodeURIComponent(filters)}`);

    // hydrated: the 搜尋詞 chip reflects the incoming q.
    expect(await screen.findByRole('button', { name: /含 shoe/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清除全部' }));
    await waitFor(() => expect(router.state.location.search.filters).toBeUndefined());
  });
});
