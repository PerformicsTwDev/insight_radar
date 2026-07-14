import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** MSW node server（Vitest 用）；生命週期於 `src/test/setup.ts` 掛載（listen / resetHandlers / close）。 */
export const server = setupServer(...handlers);
