import { http, HttpResponse } from 'msw';
import {
  cancelKeywordAnalysis,
  createKeywordAnalysis,
  getKeywordAnalysisStatus,
} from './keywordAnalyses';
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
      http.post('/api/v1/keyword-analyses', () =>
        HttpResponse.json({ nope: true }, { status: 500 }),
      ),
    );

    const result = await createKeywordAnalysis(validBody);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBeUndefined();
    }
  });
});

describe('TC-35 · getKeywordAnalysisStatus (GET :id DB-truth egress)', () => {
  it('returns { kind: ok, status } on a valid 200 (C3: strict status enum)', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id', () =>
        HttpResponse.json(
          { status: 'partial', progress: { percent: 90 }, result: { count: 8 } },
          { status: 200 },
        ),
      ),
    );

    expect(await getKeywordAnalysisStatus(ANALYSIS_ID)).toEqual({
      kind: 'ok',
      status: { status: 'partial', progress: { percent: 90 }, result: { count: 8 } },
    });
  });

  it('returns { kind: not_found } on a 404 (deleted / expired / other-owner id) — M1-R1', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id', () => new HttpResponse(null, { status: 404 })),
    );
    expect(await getKeywordAnalysisStatus(ANALYSIS_ID)).toEqual({ kind: 'not_found' });
  });

  it('returns { kind: unavailable } on a transient non-2xx (5xx)', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id', () => new HttpResponse(null, { status: 500 })),
    );
    expect(await getKeywordAnalysisStatus(ANALYSIS_ID)).toEqual({ kind: 'unavailable' });
  });

  it('returns { kind: unavailable } when the body fails validation (unknown status value)', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id', () =>
        HttpResponse.json({ status: 'bogus' }, { status: 200 }),
      ),
    );
    expect(await getKeywordAnalysisStatus(ANALYSIS_ID)).toEqual({ kind: 'unavailable' });
  });
});

describe('TC-35 · cancelKeywordAnalysis (DELETE :id egress)', () => {
  it('returns true when the backend accepts the cancel', async () => {
    server.use(
      http.delete('/api/v1/keyword-analyses/:id', () => new HttpResponse(null, { status: 200 })),
    );
    expect(await cancelKeywordAnalysis(ANALYSIS_ID)).toBe(true);
  });

  it('returns false when the cancel is rejected', async () => {
    server.use(
      http.delete('/api/v1/keyword-analyses/:id', () => new HttpResponse(null, { status: 409 })),
    );
    expect(await cancelKeywordAnalysis(ANALYSIS_ID)).toBe(false);
  });
});
