import { http, HttpResponse } from 'msw';
import { describe, it, expect } from 'vitest';
import { postQuery, postQueryAllPages, type QueryRequest } from './query';
import { server } from './msw/server';

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const PATH = '/api/v1/keyword-analyses/:id/query';

/**
 * TC-34 (FR-5/FR-8) — `POST /query` egress: the under-documented request body is
 * sent verbatim via the body serializer, and the (openapi-untyped) response body
 * is zod-validated as a structural union over the three view shapes (table |
 * trend | chart), tagged with a `kind` discriminant. A body matching none, or any
 * non-2xx, degrades to `ok:false` (never throws).
 */
describe('TC-34 · postQuery (request body + view-shape union parsing)', () => {
  it('POSTs the request body to :id/query and parses a trend view', async () => {
    let method: string | undefined;
    let receivedBody: unknown;
    let receivedUrl: string | undefined;
    server.use(
      http.post(PATH, async ({ request }) => {
        method = request.method;
        receivedUrl = request.url;
        receivedBody = await request.json();
        return HttpResponse.json(
          {
            view: 'trend',
            axis: ['2026-01', '2026-02'],
            total: [300, 250],
            series: [{ keyword: 'running shoes', points: [100, null] }],
          },
          { status: 200 },
        );
      }),
    );

    const result = await postQuery(ID, { view: 'trend' });

    expect(method).toBe('POST');
    expect(new URL(receivedUrl ?? '').pathname).toBe(`/api/v1/keyword-analyses/${ID}/query`);
    expect(receivedBody).toEqual({ view: 'trend' });
    expect(result.ok).toBe(true);
    if (result.ok && result.view.kind === 'trend') {
      expect(result.view.axis).toEqual(['2026-01', '2026-02']);
      expect(result.view.total).toEqual([300, 250]);
      expect(result.view.series[0].points).toEqual([100, null]);
    } else {
      throw new Error('expected a trend view');
    }
  });

  it('sends the full request body (filters) verbatim through the serializer', async () => {
    let receivedBody: unknown;
    server.use(
      http.post(PATH, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          { view: 'trend', axis: [], total: [], series: [] },
          { status: 200 },
        );
      }),
    );

    await postQuery(ID, { view: 'trend', filters: { q: 'shoes', volumeMin: 100 } });
    expect(receivedBody).toEqual({ view: 'trend', filters: { q: 'shoes', volumeMin: 100 } });
  });

  it('parses a table view (columns / rows / pagination)', async () => {
    server.use(
      http.post(PATH, () =>
        HttpResponse.json(
          {
            view: 'keywords',
            columns: [{ key: 'text', label: '搜尋詞', type: 'text' }],
            rows: [{ text: 'running shoes', avgMonthlySearches: 12000 }],
            pagination: { total: 3686, page: 1, pageSize: 25, cursor: null },
          },
          { status: 200 },
        ),
      ),
    );

    const result = await postQuery(ID, { view: 'keywords' });
    expect(result.ok).toBe(true);
    if (result.ok && result.view.kind === 'table') {
      expect(result.view.columns[0]).toEqual({ key: 'text', label: '搜尋詞', type: 'text' });
      expect(result.view.rows[0].text).toBe('running shoes');
      expect(result.view.pagination.total).toBe(3686);
      expect(result.view.pagination.cursor).toBeNull();
    } else {
      throw new Error('expected a table view');
    }
  });

  it('parses a chart view (groups / meta)', async () => {
    server.use(
      http.post(PATH, () =>
        HttpResponse.json(
          {
            view: 'intent_distribution',
            groups: [{ key: { intent: 'commercial' }, measures: { count: 42, avg: null } }],
            meta: { total: 1, truncated: false },
          },
          { status: 200 },
        ),
      ),
    );

    const result = await postQuery(ID, { view: 'intent_distribution' });
    expect(result.ok).toBe(true);
    if (result.ok && result.view.kind === 'chart') {
      expect(result.view.groups[0].key).toEqual({ intent: 'commercial' });
      expect(result.view.groups[0].measures).toEqual({ count: 42, avg: null });
      expect(result.view.meta.truncated).toBe(false);
    } else {
      throw new Error('expected a chart view');
    }
  });

  it('degrades to ok:false when the 200 body matches no view shape', async () => {
    server.use(
      http.post(PATH, () => HttpResponse.json({ view: 'mystery', nope: true }, { status: 200 })),
    );
    expect(await postQuery(ID, { view: 'mystery' })).toEqual({ ok: false, status: 200 });
  });

  it('maps a 400 ErrorResponse cleanly (fields surfaced)', async () => {
    server.use(
      http.post(PATH, () =>
        HttpResponse.json(
          {
            statusCode: 400,
            code: 'VALIDATION',
            message: 'Validation failed',
            fields: { view: ["unknown view 'mystery'"] },
            path: `/api/v1/keyword-analyses/${ID}/query`,
            timestamp: '2026-07-15T00:00:00.000Z',
          },
          { status: 400 },
        ),
      ),
    );

    const result = await postQuery(ID, { view: 'mystery' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error?.fields).toEqual({ view: ["unknown view 'mystery'"] });
    }
  });

  it('leaves error undefined for a non-ErrorResponse error body (5xx)', async () => {
    server.use(http.post(PATH, () => HttpResponse.json({ nope: true }, { status: 500 })));
    const result = await postQuery(ID, { view: 'trend' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBeUndefined();
    }
  });

  it('an unstubbed :id/query hits the shared default handler — empty trend / empty table (T7.4)', async () => {
    // No `server.use` override → the default handler (src/api/msw/handlers.ts) responds so
    // the 搜尋詞總表 embedded 趨勢 card (T7.4) renders deterministically: `trend` → an empty
    // trend axis; any other view → an empty table.
    const trend = await postQuery(ID, { view: 'trend' });
    expect(trend.ok).toBe(true);
    if (trend.ok && trend.view.kind === 'trend') expect(trend.view.axis).toEqual([]);

    const table = await postQuery(ID, { view: 'intent_distribution' });
    expect(table.ok).toBe(true);
    if (table.ok && table.view.kind === 'table') expect(table.view.rows).toEqual([]);
  });
});

/**
 * M7-R20 (xhigh finding [0]) — `postQueryAllPages`: the 購買歷程主題 all-stages client-join
 * (KeywordsView) needs EVERY keyword's stage, but the backend `/query` hard-caps a single page at
 * `QUERY_MAX_PAGE_SIZE` (default 200): `pageSize > 200 → 400` (query-view.service.ts / snapshot-
 * query.service.ts). The prior `pageSize: 100_000` was silently rejected → the column stuck on
 * shimmer forever. This helper fetches the whole set by following the cursor within the cap, and
 * fails loud (never a partial/truncated map) if any page errors.
 */
describe('M7-R20 · postQueryAllPages (cursor-follow within backend pageSize cap)', () => {
  it('follows the cursor across pages, never exceeds the 200 cap, accumulates every row', async () => {
    const seenPageSizes: number[] = [];
    const seenCursors: (string | undefined)[] = [];
    server.use(
      http.post(PATH, async ({ request }) => {
        const body = (await request.json()) as QueryRequest;
        seenPageSizes.push(body.pagination?.pageSize ?? -1);
        seenCursors.push(body.pagination?.cursor);
        const table = (rows: Record<string, unknown>[], page: number, cursor: string | null) =>
          HttpResponse.json({
            view: 'journey',
            columns: [
              { key: 'normalizedText', label: 'kw', type: 'text' },
              { key: 'stage', label: 'stage', type: 'text' },
            ],
            rows,
            pagination: { total: 250, page, pageSize: 200, cursor },
          });
        if (body.pagination?.cursor === undefined) {
          return table(
            Array.from({ length: 200 }, (_, i) => ({
              normalizedText: `kw${i}`,
              stage: 'awareness',
            })),
            1,
            'c1',
          );
        }
        return table(
          Array.from({ length: 50 }, (_, i) => ({
            normalizedText: `kw${200 + i}`,
            stage: 'consideration',
          })),
          2,
          null,
        );
      }),
    );

    const result = await postQueryAllPages(ID, {
      view: 'journey',
      select: ['normalizedText', 'stage'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // Every stage row across both pages — the 201st+ keyword (dropped by the old first-page cap) is joined.
    expect(result.rows).toHaveLength(250);
    expect(result.rows[249]).toEqual({ normalizedText: 'kw249', stage: 'consideration' });
    // The [0] regression guard: never requests more than the backend cap (100_000 would 400).
    expect(Math.max(...seenPageSizes)).toBeLessThanOrEqual(200);
    expect(seenCursors).toEqual([undefined, 'c1']);
  });

  it('fails loud (ok:false) when a page errors mid-pagination — no partial map', async () => {
    let call = 0;
    server.use(
      http.post(PATH, () => {
        call += 1;
        if (call === 1) {
          return HttpResponse.json({
            view: 'journey',
            columns: [{ key: 'normalizedText', label: 'kw', type: 'text' }],
            rows: [{ normalizedText: 'kw0', stage: 'awareness' }],
            pagination: { total: 250, page: 1, pageSize: 200, cursor: 'c1' },
          });
        }
        return HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 });
      }),
    );

    const result = await postQueryAllPages(ID, { view: 'journey' });
    expect(result.ok).toBe(false);
  });

  it('single-page result (cursor null on page 1) returns immediately with one request', async () => {
    let calls = 0;
    server.use(
      http.post(PATH, () => {
        calls += 1;
        return HttpResponse.json({
          view: 'journey',
          columns: [{ key: 'normalizedText', label: 'kw', type: 'text' }],
          rows: [{ normalizedText: 'only', stage: 'awareness' }],
          pagination: { total: 1, page: 1, pageSize: 200, cursor: null },
        });
      }),
    );

    const result = await postQueryAllPages(ID, { view: 'journey' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(1);
    expect(calls).toBe(1);
  });
});
