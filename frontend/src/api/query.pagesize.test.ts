import { http, HttpResponse } from 'msw';
import { describe, it, expect, vi } from 'vitest';
import { server } from './msw/server';
import { postQueryAllPages } from './query';

/**
 * M7-R25 (machine milestone-review major) — `postQueryAllPages` must page at `config.maxPageSize`
 * (the `VITE_MAX_PAGE_SIZE` mirror of backend `QUERY_MAX_PAGE_SIZE`), NEVER a hardcoded literal.
 * The prior `MAX_QUERY_PAGE_SIZE = 200` would 400 on every page — and permanently re-freeze the
 * 購買歷程主題 column (the exact M7-R20 [0] bug) — if an operator lowered the backend cap below 200.
 * This drift guard mocks the config to a cap BELOW that old literal (isolated to this file, since
 * `vi.mock` is per-file) and asserts the request payload follows it.
 */
vi.mock('../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/env')>();
  return { ...actual, config: { ...actual.config, maxPageSize: 50 } };
});

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const PATH = '/api/v1/keyword-analyses/:id/query';

describe('M7-R25 · postQueryAllPages sources its page size from config.maxPageSize (not a literal)', () => {
  it('sends config.maxPageSize (50 here — below the old hardcoded 200) on every cursor-follow page', async () => {
    const seen: (number | undefined)[] = [];
    server.use(
      http.post(PATH, async ({ request }) => {
        const body = (await request.json()) as {
          pagination?: { pageSize?: number; cursor?: string };
        };
        seen.push(body.pagination?.pageSize);
        const last = body.pagination?.cursor === 'c1';
        return HttpResponse.json({
          view: 'journey',
          columns: [{ key: 'normalizedText', label: 'kw', type: 'text' }],
          rows: [{ normalizedText: `k${seen.length}`, stage: 'awareness' }],
          pagination: { total: 2, page: seen.length, pageSize: 50, cursor: last ? null : 'c1' },
        });
      }),
    );

    const result = await postQueryAllPages(ID, {
      view: 'journey',
      select: ['normalizedText', 'stage'],
    });

    expect(result.ok).toBe(true);
    // A hardcoded 200 would show up as [200, 200] and (with a real cap < 200) 400 on the first page;
    // config-driven pagination sends the mocked cap on every page.
    expect(seen).toEqual([50, 50]);
  });
});
