import { http, HttpResponse } from 'msw';
import { buildKeywordsQuery, getKeywords, getKeywordsView } from './keywords';
import { server } from './msw/server';

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const okBody = {
  data: [
    {
      text: 'running shoes',
      intentLabels: ['commercial'],
      avgMonthlySearches: 12000,
      competition: 'HIGH',
      competitionIndex: 88,
      cpcLow: 1.2,
      cpcHigh: 3.4,
    },
  ],
  meta: { total: 3686, page: 2, pageSize: 25, cursor: null },
};

describe('TC-33 · buildKeywordsQuery (pagination / sort / filter → query string)', () => {
  it('serializes pagination + sort + scalar filters, omitting undefined', () => {
    const sp = new URLSearchParams(
      buildKeywordsQuery({
        page: 2,
        pageSize: 25,
        sortBy: 'avgMonthlySearches',
        sortDir: 'desc',
        q: 'shoes',
        volumeMin: 100,
        cursor: undefined,
      }),
    );
    expect(sp.get('page')).toBe('2');
    expect(sp.get('pageSize')).toBe('25');
    expect(sp.get('sortBy')).toBe('avgMonthlySearches');
    expect(sp.get('sortDir')).toBe('desc');
    expect(sp.get('q')).toBe('shoes');
    expect(sp.get('volumeMin')).toBe('100');
    expect(sp.has('cursor')).toBe(false);
  });

  it('serializes array filters as repeated params and drops empty entries', () => {
    const sp = new URLSearchParams(
      buildKeywordsQuery({ intent: ['informational', '', 'commercial'], competition: [] }),
    );
    expect(sp.getAll('intent')).toEqual(['informational', 'commercial']);
    expect(sp.has('competition')).toBe(false);
  });

  it('drops empty-string scalar values (empty ≠ 0 — 缺值不轉 0 界，M5-R1 parity)', () => {
    expect(buildKeywordsQuery({ q: '', volumeMax: undefined })).toBe('');
  });
});

describe('TC-33 · getKeywords (GET :id/keywords egress + contract)', () => {
  it('sends the id path + query params and parses the { data, meta } body', async () => {
    let receivedUrl: string | undefined;
    server.use(
      http.get('/api/v1/keyword-analyses/:id/keywords', ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json(okBody, { status: 200 });
      }),
    );

    const result = await getKeywords(ID, {
      page: 2,
      pageSize: 25,
      sortBy: 'avgMonthlySearches',
      sortDir: 'desc',
      q: 'shoes',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].text).toBe('running shoes');
      expect(result.meta.total).toBe(3686);
      expect(result.meta.cursor).toBeNull();
    }

    expect(receivedUrl).toBeDefined();
    const url = new URL(receivedUrl ?? '');
    expect(url.pathname).toBe(`/api/v1/keyword-analyses/${ID}/keywords`);
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('sortBy')).toBe('avgMonthlySearches');
    expect(url.searchParams.get('q')).toBe('shoes');
  });

  it('preserves null metric cells verbatim (null, never 0 — C12)', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id/keywords', () =>
        HttpResponse.json(
          {
            data: [
              {
                text: '缺值列',
                intentLabels: [],
                avgMonthlySearches: null,
                competition: 'LOW',
                competitionIndex: null,
                cpcLow: null,
                cpcHigh: null,
              },
            ],
            meta: { total: 1, page: 1, pageSize: 25, cursor: null },
          },
          { status: 200 },
        ),
      ),
    );

    const result = await getKeywords(ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0].avgMonthlySearches).toBeNull();
      expect(result.rows[0].cpcLow).toBeNull();
      expect(result.rows[0].competitionIndex).toBeNull();
    }
  });

  it('parses monthlyVolumes, keeping a missing month null (never 0 — C12)', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id/keywords', () =>
        HttpResponse.json(
          {
            data: [
              {
                text: 'running shoes',
                intentLabels: ['commercial'],
                avgMonthlySearches: 12000,
                competition: 'HIGH',
                competitionIndex: 88,
                cpcLow: 1.2,
                cpcHigh: 3.4,
                monthlyVolumes: [
                  { year: 2026, month: 1, searches: 100 },
                  { year: 2026, month: 2, searches: null },
                  { year: 2026, month: 3, searches: 140 },
                ],
              },
            ],
            meta: { total: 1, page: 1, pageSize: 25, cursor: null },
          },
          { status: 200 },
        ),
      ),
    );

    const result = await getKeywords(ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // the whole series round-trips verbatim, and the missing month stays null (never 0).
      expect(result.rows[0].monthlyVolumes).toEqual([
        { year: 2026, month: 1, searches: 100 },
        { year: 2026, month: 2, searches: null },
        { year: 2026, month: 3, searches: 140 },
      ]);
      expect(result.rows[0].monthlyVolumes[1].searches).toBeNull();
    }
  });

  it('defaults monthlyVolumes to [] when the backend list row omits it (forward-compat)', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id/keywords', () =>
        HttpResponse.json(okBody, { status: 200 }),
      ),
    );

    const result = await getKeywords(ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // okBody carries no monthlyVolumes → defaults to [] (row later renders the no-data sparkline).
      expect(result.rows[0].monthlyVolumes).toEqual([]);
    }
  });

  it('degrades to ok:false when the 200 body fails schema validation', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id/keywords', () =>
        HttpResponse.json({ data: 'nope' }, { status: 200 }),
      ),
    );
    expect(await getKeywords(ID)).toEqual({ ok: false, status: 200 });
  });

  it('maps a 400 ErrorResponse cleanly (fields surfaced)', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id/keywords', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            code: 'VALIDATION',
            message: 'Validation failed',
            fields: { pageSize: ['pageSize is too large'] },
            path: '/api/v1/keyword-analyses/x/keywords',
            timestamp: '2026-07-14T00:00:00.000Z',
          },
          { status: 400 },
        ),
      ),
    );

    const result = await getKeywords(ID, { pageSize: 9999 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error?.fields).toEqual({ pageSize: ['pageSize is too large'] });
    }
  });

  it('leaves error undefined for a non-ErrorResponse error body (5xx)', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id/keywords', () =>
        HttpResponse.json({ nope: true }, { status: 500 }),
      ),
    );

    const result = await getKeywords(ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBeUndefined();
    }
  });
});

describe('M7-R1 · getKeywordsView (POST /query {view:keywords} → KeywordRow[])', () => {
  const QUERY_PATH = '/api/v1/keyword-analyses/:id/query';

  it('maps a keywords-view row to KeywordRow (intent→intentLabels, keeps monthlyVolumes + normalizedText)', async () => {
    server.use(
      http.post(QUERY_PATH, () =>
        HttpResponse.json({
          view: 'keywords',
          columns: [],
          rows: [
            {
              text: 'running shoes',
              normalizedText: 'running shoes',
              intent: ['commercial'],
              avgMonthlySearches: 12000,
              competition: '高',
              competitionIndex: 80,
              cpcLow: 1.2,
              cpcHigh: 3.4,
              monthlyVolumes: [{ year: 2026, month: 1, searches: 100 }],
            },
          ],
          pagination: { total: 1, page: 1, pageSize: 25, cursor: null },
        }),
      ),
    );
    const result = await getKeywordsView(ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.rows[0]).toEqual({
      text: 'running shoes',
      normalizedText: 'running shoes',
      intentLabels: ['commercial'],
      avgMonthlySearches: 12000,
      competition: '高',
      competitionIndex: 80,
      cpcLow: 1.2,
      cpcHigh: 3.4,
      monthlyVolumes: [{ year: 2026, month: 1, searches: 100 }],
    });
    expect(result.meta).toEqual({ total: 1, page: 1, pageSize: 25, cursor: null });
  });

  it('sends view=keywords + the volume-bearing select + filters/sort/pagination', async () => {
    let body: unknown;
    server.use(
      http.post(QUERY_PATH, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          view: 'keywords',
          columns: [],
          rows: [],
          pagination: { total: 0, page: 2, pageSize: 25, cursor: null },
        });
      }),
    );
    await getKeywordsView(ID, {
      q: '吸塵器',
      page: 2,
      pageSize: 25,
      sortBy: 'avgMonthlySearches',
      sortDir: 'desc',
    });
    expect(body).toMatchObject({
      view: 'keywords',
      filters: { q: '吸塵器' },
      sort: [{ field: 'avgMonthlySearches', direction: 'desc' }],
      pagination: { page: 2, pageSize: 25 },
    });
    const select = (body as { select: string[] }).select;
    expect(select).toContain('monthlyVolumes');
    expect(select).toContain('normalizedText');
  });

  it('degrades to ok:false on a non-2xx', async () => {
    server.use(http.post(QUERY_PATH, () => new HttpResponse(null, { status: 500 })));
    expect(await getKeywordsView(ID)).toEqual({ ok: false, status: 500, error: undefined });
  });

  it('degrades to ok:false when the response is not a table view (defensive)', async () => {
    server.use(
      http.post(QUERY_PATH, () =>
        HttpResponse.json({ view: 'keywords', axis: ['2026-01'], total: [10], series: [] }),
      ),
    );
    expect(await getKeywordsView(ID)).toEqual({ ok: false, status: 200 });
  });

  it('drops an unparseable row rather than failing the whole page', async () => {
    server.use(
      http.post(QUERY_PATH, () =>
        HttpResponse.json({
          view: 'keywords',
          columns: [],
          rows: [{ text: 'ok', intent: [], monthlyVolumes: [] }, { notText: 'bad' }],
          pagination: { total: 2, page: 1, pageSize: 25, cursor: null },
        }),
      ),
    );
    const result = await getKeywordsView(ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].text).toBe('ok');
  });
});
