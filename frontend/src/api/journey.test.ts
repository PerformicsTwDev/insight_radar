import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from './msw/server';
import { fetchJourneyRun, fetchJourneyStatus, startJourney } from './journey';
import { postQuery } from './query';

/**
 * TC-42 (FR-15) — the 購買歷程 (journey) job egress contract + the
 * `POST /query {view:'journey'}` stage-table contract. `POST :id/journey` returns a
 * 202 `{ journeyJobId }` (zod-validated); a non-2xx is mapped to `ok:false` with the
 * parsed `ErrorResponse`. `GET :id/journey` returns a `JourneyStatusResponse` whose
 * nullable `keywordCount` stays null (C12); a malformed body or 404 degrades to
 * `ok:false`. `fetchJourneyStatus` maps the journey run's own status to a
 * `StatusFetch` (journey-scoped, so the job never settles off the main analysis).
 * Never throws. External API mocked via MSW (`server.use`).
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const POST_PATH = '/api/v1/keyword-analyses/:id/journey';
const GET_PATH = '/api/v1/keyword-analyses/:id/journey';
const QUERY_PATH = '/api/v1/keyword-analyses/:id/query';

describe('TC-42 · startJourney (POST :id/journey)', () => {
  it('202 → { ok:true, journeyJobId } (enqueue-only, no request body)', async () => {
    let method: string | undefined;
    server.use(
      http.post(POST_PATH, ({ request }) => {
        method = request.method;
        return HttpResponse.json({ journeyJobId: 'journey-42' }, { status: 202 });
      }),
    );

    const result = await startJourney(ID);

    expect(result).toEqual({ ok: true, journeyJobId: 'journey-42' });
    expect(method).toBe('POST');
  });

  it('202 but a malformed body (no journeyJobId) → ok:false with the status', async () => {
    server.use(http.post(POST_PATH, () => HttpResponse.json({ wrong: 'shape' }, { status: 202 })));

    expect(await startJourney(ID)).toEqual({ ok: false, status: 202 });
  });

  it('non-2xx with an ErrorResponse body → ok:false + status + parsed error (snapshot-not-ready hint)', async () => {
    server.use(
      http.post(POST_PATH, () =>
        HttpResponse.json(
          { statusCode: 409, code: 'snapshot_not_ready', message: '請先完成關鍵字分析' },
          { status: 409 },
        ),
      ),
    );

    const result = await startJourney(ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error?.code).toBe('snapshot_not_ready');
    }
  });

  it('non-2xx with a non-ErrorResponse body → ok:false, error undefined', async () => {
    server.use(http.post(POST_PATH, () => HttpResponse.json(['nope'], { status: 404 })));

    const result = await startJourney(ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBeUndefined();
    }
  });
});

describe('TC-42 · fetchJourneyRun (GET :id/journey)', () => {
  it('200 valid JourneyStatusResponse → { ok:true, run } (null keywordCount preserved, C12)', async () => {
    server.use(
      http.get(GET_PATH, () =>
        HttpResponse.json({
          journeyJobId: 'run-1',
          status: 'running',
          progress: { phase: 'classifying', percent: 40 },
          keywordCount: null,
        }),
      ),
    );

    const result = await fetchJourneyRun(ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.journeyJobId).toBe('run-1');
      expect(result.run.status).toBe('running');
      expect(result.run.keywordCount).toBeNull();
    }
  });

  it('200 malformed body → ok:false with the status', async () => {
    server.use(http.get(GET_PATH, () => HttpResponse.json({ status: 'running' }, { status: 200 })));

    expect(await fetchJourneyRun(ID)).toEqual({ ok: false, status: 200 });
  });

  it('404 (no run) → ok:false with the status', async () => {
    server.use(http.get(GET_PATH, () => new HttpResponse(null, { status: 404 })));

    expect(await fetchJourneyRun(ID)).toEqual({ ok: false, status: 404 });
  });
});

describe('TC-42 · fetchJourneyStatus (journey-scoped DB status → StatusFetch)', () => {
  const RUN = {
    journeyJobId: 'r',
    progress: null,
    keywordCount: 10,
  };

  it('maps a valid journey run status to { kind: ok }', async () => {
    server.use(http.get(GET_PATH, () => HttpResponse.json({ ...RUN, status: 'partial' })));
    expect(await fetchJourneyStatus(ID)).toEqual({ kind: 'ok', status: { status: 'partial' } });
  });

  it('maps a 404 (no journey run) to not_found', async () => {
    server.use(http.get(GET_PATH, () => new HttpResponse(null, { status: 404 })));
    expect(await fetchJourneyStatus(ID)).toEqual({ kind: 'not_found' });
  });

  it('maps any other non-2xx to unavailable (keep polling)', async () => {
    server.use(http.get(GET_PATH, () => new HttpResponse(null, { status: 503 })));
    expect(await fetchJourneyStatus(ID)).toEqual({ kind: 'unavailable' });
  });

  it('maps an unrecognised status string to unavailable', async () => {
    server.use(http.get(GET_PATH, () => HttpResponse.json({ ...RUN, status: 'weird' })));
    expect(await fetchJourneyStatus(ID)).toEqual({ kind: 'unavailable' });
  });
});

describe('TC-42 · POST /query {view:"journey"} (stage 表 via view-router)', () => {
  it('parses the journey table view (columns / rows / pagination; null 月均搜量 preserved C12)', async () => {
    let receivedBody: unknown;
    server.use(
      http.post(QUERY_PATH, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          {
            view: 'journey',
            columns: [
              { key: 'text', label: '關鍵字', type: 'text' },
              { key: 'normalizedText', label: '正規化文字', type: 'text' },
              { key: 'stage', label: '購買歷程階段', type: 'text' },
              { key: 'avgMonthlySearches', label: '月均搜量', type: 'number' },
            ],
            rows: [
              {
                text: 'iphone 16 vs 15 pro',
                normalizedText: 'iphone 16 vs 15 pro',
                stage: 'spec_comparison',
                avgMonthlySearches: 12000,
              },
              {
                text: '早上起床腰痛',
                normalizedText: '早上起床腰痛',
                stage: 'pain_awareness',
                avgMonthlySearches: null,
              },
            ],
            pagination: { total: 2, page: 1, pageSize: 25, cursor: null },
          },
          { status: 200 },
        );
      }),
    );

    const result = await postQuery(ID, { view: 'journey' });

    expect(receivedBody).toEqual({ view: 'journey' });
    expect(result.ok).toBe(true);
    if (result.ok && result.view.kind === 'table') {
      expect(result.view.view).toBe('journey');
      expect(result.view.rows[0].stage).toBe('spec_comparison');
      expect(result.view.rows[1].avgMonthlySearches).toBeNull();
      expect(result.view.pagination.total).toBe(2);
    } else {
      throw new Error('expected a journey table view');
    }
  });
});
