import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { generateAiInsight } from './aiInsight';
import { server } from './msw/server';
import { chipsToSpec, serializeFiltersToUrl, type FilterSpec } from '../lib/filterSpec';

/**
 * TC-42 (contract, partial) — the per-view `ai-insight` egress (T4.3, FR-17 /
 * AC-17.1). The typed request carries `{ view, filters }`; the backend (FR-32)
 * answers 200 `{ view, insight, generatedAt }`. The openapi types the response body
 * as `never` (#392 class), so the 200 body is runtime-zod-validated here. **C4**:
 * the filters cross the wire in the ONE canonical form (byte-identical to the
 * `/query` + shareable-URL serialization), so the backend filters-hash matches. A
 * 502 (LLM failure) / 409 (not ready) / invalid body all degrade to `ok:false`.
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ROUTE = '/api/v1/keyword-analyses/:id/ai-insight';
const OK_BODY = {
  view: 'keywords',
  insight: '導購型意圖為主，使用者多在比較品牌與價格。',
  generatedAt: '2026-07-21T00:00:00.000Z',
};

describe('TC-42 · generateAiInsight (per-view ai-insight egress)', () => {
  it('sends { view, filters } and returns the insight on 200', async () => {
    let received: unknown;
    let seenId: string | undefined;
    server.use(
      http.post(ROUTE, async ({ request, params }) => {
        received = await request.json();
        seenId = params.id as string;
        return HttpResponse.json(OK_BODY, { status: 200 });
      }),
    );

    const result = await generateAiInsight(ID, 'keywords', { volumeMin: 100, q: 'shoe' });

    expect(result).toEqual({
      ok: true,
      insight: '導購型意圖為主，使用者多在比較品牌與價格。',
      view: 'keywords',
      generatedAt: '2026-07-21T00:00:00.000Z',
    });
    expect(received).toEqual({ view: 'keywords', filters: { volumeMin: 100, q: 'shoe' } });
    expect(seenId).toBe(ID);
  });

  it('C4: sends canonical filters — byte-identical to the /query + URL serialization single-point', async () => {
    let received: { view: string; filters?: FilterSpec } | undefined;
    server.use(
      http.post(ROUTE, async ({ request }) => {
        received = (await request.json()) as { view: string; filters?: FilterSpec };
        return HttpResponse.json(OK_BODY, { status: 200 });
      }),
    );

    // Built from chips (source of truth). Intent given before volume (non-canonical
    // input order); the empty competition set is a term the codec drops.
    const spec = chipsToSpec([
      { type: 'options', field: 'intent', values: ['commercial'] },
      { type: 'range', field: 'volume', min: 100 },
      { type: 'options', field: 'competition', values: [] },
    ]);

    await generateAiInsight(ID, 'keywords', spec);

    // The wire filters equal the canonical spec (empty term dropped, deterministic order) …
    expect(received?.filters).toEqual({ volumeMin: 100, intent: ['commercial'] });
    // … and serialize byte-identically to the shareable-URL / /query canonical form (C4).
    expect(JSON.stringify(received?.filters)).toBe(serializeFiltersToUrl(spec));
  });

  it('omits filters entirely when the canonical spec is empty (matches the /query minimal body)', async () => {
    let received: unknown;
    server.use(
      http.post(ROUTE, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(OK_BODY, { status: 200 });
      }),
    );

    await generateAiInsight(ID, 'keywords', {});

    expect(received).toEqual({ view: 'keywords' });
  });

  it('maps a 502 (AI_INSIGHT_GENERATION_FAILED) to ok:false — no half summary', async () => {
    server.use(http.post(ROUTE, () => new HttpResponse(null, { status: 502 })));
    const result = await generateAiInsight(ID, 'keywords', {});
    expect(result).toEqual({ ok: false, status: 502 });
  });

  it('maps a 409 (snapshot / feature not ready) to ok:false with the status', async () => {
    server.use(
      http.post(ROUTE, () =>
        HttpResponse.json({ statusCode: 409, code: 'feature_not_ready' }, { status: 409 }),
      ),
    );
    const result = await generateAiInsight(ID, 'journey', {});
    expect(result).toEqual({ ok: false, status: 409 });
  });

  it('degrades to ok:false when the 200 body is not a valid { view, insight, generatedAt } shape', async () => {
    // An empty insight is a half/absent summary — it must not surface as ok.
    server.use(http.post(ROUTE, () => HttpResponse.json({ view: 'keywords', insight: '' }, { status: 200 })));
    const result = await generateAiInsight(ID, 'keywords', {});
    expect(result).toEqual({ ok: false, status: 200 });
  });
});
