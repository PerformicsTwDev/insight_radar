import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { startBatchIntentSummary, summarizeKeywordIntent } from './aiIntentSummary';
import { server } from './msw/server';

/**
 * TC-28 (contract) — the single-cell ✦ AI-intent-summary stub egress (T4.1,
 * FR-18 / AC-18.1 / AC-31.2). The real endpoint is backend FR-31 (SERP-grounded,
 * deferred past M14, not yet in openapi), so this stage stubs
 * `POST :id/ai-intent-summary` via MSW and validates the body at runtime. The
 * typed request carries `{ scope:'keyword', normalizedText }`; the 200 body is
 * `{ normalizedText, summary }`; `scope:'keyword'` with no normalizedText → 400.
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ROUTE = '/api/v1/keyword-analyses/:id/ai-intent-summary';

describe('TC-28 · summarizeKeywordIntent', () => {
  it('sends { scope:"keyword", normalizedText } and returns the summary on 200', async () => {
    let received: unknown;
    let seenId: string | undefined;
    server.use(
      http.post(ROUTE, async ({ request, params }) => {
        received = await request.json();
        seenId = params.id as string;
        return HttpResponse.json(
          { normalizedText: 'running shoes', summary: '導購型：使用者多在比較品牌與價格' },
          { status: 200 },
        );
      }),
    );

    const result = await summarizeKeywordIntent(ID, 'running shoes');

    expect(result).toEqual({ ok: true, summary: '導購型：使用者多在比較品牌與價格' });
    expect(received).toEqual({ scope: 'keyword', normalizedText: 'running shoes' });
    expect(seenId).toBe(ID);
  });

  it('maps a 400 (scope:keyword with no normalizedText, AC-31.2) to the invalid kind', async () => {
    server.use(
      http.post(ROUTE, async ({ request }) => {
        const body = (await request.json()) as { normalizedText?: string };
        // The backend rejects a keyword-scope request that carries no normalizedText.
        if (!body.normalizedText) {
          return HttpResponse.json(
            { statusCode: 400, code: 'normalizedText_required' },
            { status: 400 },
          );
        }
        return HttpResponse.json({ normalizedText: body.normalizedText, summary: 's' });
      }),
    );

    const result = await summarizeKeywordIntent(ID, undefined);
    expect(result).toEqual({ ok: false, status: 400, kind: 'invalid' });
  });

  it('maps any other non-2xx (e.g. 500, or the deferred 409 serp gate) to the unavailable kind', async () => {
    server.use(http.post(ROUTE, () => new HttpResponse(null, { status: 500 })));
    const result = await summarizeKeywordIntent(ID, 'running shoes');
    expect(result).toEqual({ ok: false, status: 500, kind: 'unavailable' });
  });

  it('degrades to unavailable when the 200 body is not a valid { normalizedText, summary } shape', async () => {
    server.use(http.post(ROUTE, () => HttpResponse.json({ summary: 123 }, { status: 200 })));
    const result = await summarizeKeywordIntent(ID, 'running shoes');
    expect(result).toEqual({ ok: false, status: 200, kind: 'unavailable' });
  });
});

/**
 * TC-42 (contract, partial) — the ✦ column-header batch egress (T4.2, FR-18 /
 * AC-18.1). The header triggers a `scope:'snapshot'` async job; the same
 * `POST :id/ai-intent-summary` endpoint answers 202 `{ jobId }` (vs the single
 * cell's synchronous 200). Backend FR-31 is deferred, so the endpoint is stubbed
 * via MSW and the body is runtime-validated. Progressive per-cell fill then arrives
 * over SSE (covered in the hook/component tests) — this asserts only the start
 * egress contract.
 */
describe('TC-42 · startBatchIntentSummary (scope:snapshot → 202 async job)', () => {
  it('sends { scope:"snapshot" } and returns the jobId on 202', async () => {
    let received: unknown;
    let seenId: string | undefined;
    server.use(
      http.post(ROUTE, async ({ request, params }) => {
        received = await request.json();
        seenId = params.id as string;
        return HttpResponse.json({ jobId: 'batch-job-1' }, { status: 202 });
      }),
    );

    const result = await startBatchIntentSummary(ID);

    expect(result).toEqual({ ok: true, jobId: 'batch-job-1' });
    expect(received).toEqual({ scope: 'snapshot' });
    expect(seenId).toBe(ID);
  });

  it('degrades to ok:false when the 202 body carries no valid jobId', async () => {
    server.use(http.post(ROUTE, () => HttpResponse.json({}, { status: 202 })));
    const result = await startBatchIntentSummary(ID);
    expect(result).toEqual({ ok: false, status: 202 });
  });

  it('maps a non-2xx (e.g. 500) to ok:false with the status', async () => {
    server.use(http.post(ROUTE, () => new HttpResponse(null, { status: 500 })));
    const result = await startBatchIntentSummary(ID);
    expect(result).toEqual({ ok: false, status: 500 });
  });
});
