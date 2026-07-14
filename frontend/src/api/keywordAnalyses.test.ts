import { http, HttpResponse } from 'msw';
import { createKeywordAnalysis } from './keywordAnalyses';
import type { paths } from './schema';
import { server } from './msw/server';

const ANALYSIS_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

// Request body bound to the generated openapi `paths` — a contract drift on the
// create DTO becomes a compile error here (TC-32 typed-against-schema).
type CreateBody =
  paths['/api/v1/keyword-analyses']['post']['requestBody']['content']['application/json'];

const validBody: CreateBody = {
  seeds: ['running shoes'],
  geo: 'TW',
  language: 'zh-TW',
  mode: 'expand',
};

describe('TC-32 · createKeywordAnalysis (POST /keyword-analyses 202 contract)', () => {
  it('sends the typed body and returns analysisId on 202', async () => {
    let received: unknown;
    server.use(
      http.post('/api/v1/keyword-analyses', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ analysisId: ANALYSIS_ID }, { status: 202 });
      }),
    );

    const result = await createKeywordAnalysis(validBody);

    expect(result).toEqual({ ok: true, analysisId: ANALYSIS_ID });
    expect(received).toEqual(validBody);
  });

  it('returns ok:false when the 202 body lacks analysisId', async () => {
    server.use(http.post('/api/v1/keyword-analyses', () => HttpResponse.json({}, { status: 202 })));

    const result = await createKeywordAnalysis(validBody);

    expect(result.ok).toBe(false);
  });
});

describe('TC-13 · createKeywordAnalysis error body (ErrorResponse.fields)', () => {
  it('parses a 400 ErrorResponse with field-level messages', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            code: 'VALIDATION',
            message: 'Validation failed',
            fields: { geo: ['geo is required'] },
            path: '/api/v1/keyword-analyses',
            timestamp: '2026-07-14T00:00:00.000Z',
          },
          { status: 400 },
        ),
      ),
    );

    const result = await createKeywordAnalysis(validBody);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error?.fields).toEqual({ geo: ['geo is required'] });
    }
  });

  it('leaves error undefined for a non-ErrorResponse body', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses', () => HttpResponse.json({ nope: true }, { status: 500 })),
    );

    const result = await createKeywordAnalysis(validBody);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBeUndefined();
    }
  });
});
