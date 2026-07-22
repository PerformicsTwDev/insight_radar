import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { server } from './msw/server';
import { createAiSearchAnalysis } from './aiSearchAnalyses';

/**
 * TC-64 (contract; FR-23/FR-24, backend FR-41). `POST /ai-search-analyses` is
 * enqueue-only (INV-3): the request body is bound to the generated
 * `CreateAiSearchAnalysisDto` (channel enum drift → compile error); the 202 body is
 * openapi-untyped (#392) → zod-validated here to `{ jobId }`.
 */

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const JOB_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const BRAND_PROFILE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('createAiSearchAnalysis (POST /ai-search-analyses → 202 { jobId })', () => {
  it('sends { keywords, channels, brandProfileId } and returns the jobId on 202', async () => {
    let received: unknown;
    server.use(
      http.post('/api/v1/ai-search-analyses', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ jobId: JOB_ID }, { status: 202 });
      }),
    );

    const result = await createAiSearchAnalysis({
      keywords: ['Dyson', '戴森'],
      channels: ['googleSearch', 'chatGpt'],
      brandProfileId: BRAND_PROFILE_ID,
    });

    expect(result).toEqual({ ok: true, jobId: JOB_ID });
    expect(received).toEqual({
      keywords: ['Dyson', '戴森'],
      channels: ['googleSearch', 'chatGpt'],
      brandProfileId: BRAND_PROFILE_ID,
    });
  });

  it('surfaces 400 field errors from the ErrorResponse body', async () => {
    server.use(
      http.post('/api/v1/ai-search-analyses', () =>
        HttpResponse.json(
          { statusCode: 400, code: 'VALIDATION', fields: { channels: ['至少一個抓取渠道'] } },
          { status: 400 },
        ),
      ),
    );
    const result = await createAiSearchAnalysis({ keywords: ['x'], channels: ['chatGpt'] });
    expect(result).toMatchObject({ ok: false, status: 400 });
    if (!result.ok) expect(result.error?.fields).toEqual({ channels: ['至少一個抓取渠道'] });
  });

  it('degrades to ok:false when the 202 body carries no jobId', async () => {
    server.use(
      http.post('/api/v1/ai-search-analyses', () => HttpResponse.json({}, { status: 202 })),
    );
    expect(await createAiSearchAnalysis({ keywords: ['x'], channels: ['chatGpt'] })).toEqual({
      ok: false,
      status: 202,
    });
  });
});
