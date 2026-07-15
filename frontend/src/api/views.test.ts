import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './msw/server';
import { fetchViews } from './views';

/**
 * TC-37 (contract) — the `GET /views` egress boundary (T3.1, FR-1). The openapi
 * types the 200 body as `never` (#392), so `fetchViews` zod-validates it against
 * the backend view-registry metadata contract; a body that fails the contract
 * degrades to `ok:false` so the caller can fall back (FR-1). External API mocked
 * via MSW (Design §2 — never a real backend).
 */

const KEYWORDS_META = {
  name: 'keywords',
  grain: 'keyword',
  allowedSelect: [
    { key: 'text', type: 'text' },
    { key: 'avgMonthlySearches', type: 'number' },
    { key: 'intent', type: 'array' },
  ],
  allowedFilters: ['q', 'volumeMin'],
  allowedSort: ['avgMonthlySearches'],
  responseShape: 'table',
  requiresFeature: 'keyword_metrics',
};

describe('TC-37 · fetchViews (GET /views boundary zod)', () => {
  it('parses a valid /views metadata response into typed views', async () => {
    server.use(
      http.get('/api/v1/views', () =>
        HttpResponse.json({
          views: [
            KEYWORDS_META,
            {
              name: 'intent_topics',
              grain: 'topic',
              allowedSelect: [],
              allowedFilters: [],
              allowedSort: [],
              responseShape: 'table',
              requiresFeature: 'topics',
            },
          ],
        }),
      ),
    );

    const result = await fetchViews();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.views.map((v) => v.name)).toEqual(['keywords', 'intent_topics']);
      expect(result.views[0].allowedSelect).toEqual(KEYWORDS_META.allowedSelect);
      expect(result.views[0].requiresFeature).toBe('keyword_metrics');
      expect(result.views[0].responseShape).toBe('table');
    }
  });

  it('degrades (ok:false) when a view is missing required metadata fields', async () => {
    server.use(
      http.get('/api/v1/views', () => HttpResponse.json({ views: [{ name: 'keywords' }] })),
    );
    expect(await fetchViews()).toEqual({ ok: false, status: 200 });
  });

  it('degrades (ok:false) when the body is not the { views } envelope', async () => {
    server.use(http.get('/api/v1/views', () => HttpResponse.json({ unexpected: true })));
    expect(await fetchViews()).toEqual({ ok: false, status: 200 });
  });

  it('degrades (ok:false) on an unknown responseShape (strict contract enum)', async () => {
    server.use(
      http.get('/api/v1/views', () =>
        HttpResponse.json({ views: [{ ...KEYWORDS_META, responseShape: 'galaxy' }] }),
      ),
    );
    expect(await fetchViews()).toEqual({ ok: false, status: 200 });
  });

  it('returns ok:false with the status on a non-2xx response', async () => {
    server.use(http.get('/api/v1/views', () => new HttpResponse(null, { status: 500 })));
    expect(await fetchViews()).toEqual({ ok: false, status: 500 });
  });
});
