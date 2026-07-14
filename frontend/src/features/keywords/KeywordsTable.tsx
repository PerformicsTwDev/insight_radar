import type { ReactElement } from 'react';
import type { KeywordRow } from '../../api/keywords';

/**
 * RED shell (T2.1, TC-15). A typed not-implemented placeholder so the component
 * tests are assertion-red, not compile-red (附錄 B). Green implements the
 * TanStack Table + react-virtual table with the frozen 搜尋詞 column.
 */
export function KeywordsTable(_props: { rows: KeywordRow[] }): ReactElement {
  return <div>not implemented</div>;
}
