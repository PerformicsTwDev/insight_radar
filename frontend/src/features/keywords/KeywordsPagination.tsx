import type { ReactElement } from 'react';
import type { KeywordsMeta } from '../../api/keywords';

/**
 * Server pagination + sort footer (T2.6, FR-7, Design §6 C5). Router-bound like
 * {@link KeywordsFilters}: reads page/pageSize/cursor/sortBy/sortDir off the URL
 * search params and writes the next state back via `navigate`, driving the C5
 * keyset/offset switch through the pure `lib/pagination` core.
 */
export function KeywordsPagination(_props: { readonly meta: KeywordsMeta }): ReactElement {
  throw new Error('KeywordsPagination: not implemented');
}
