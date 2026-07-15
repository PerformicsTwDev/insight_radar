import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from './msw/server';
import { fetchTopics, fetchTopicsStatus, startTopics } from './topics';

/**
 * TC-41 (FR-8) — the intent-topics job egress contract. `POST :id/topics` returns
 * a 202 `{ topicJobId }` (zod-validated); a non-2xx is mapped to `ok:false` with
 * the parsed `ErrorResponse`. `GET :id/topics` returns a `TopicsResponse` whose
 * nullable metrics stay null (C12); a malformed body or 404 degrades to `ok:false`.
 * Never throws. External API mocked via MSW (`server.use`).
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const POST_PATH = '/api/v1/keyword-analyses/:id/topics';
const GET_PATH = '/api/v1/keyword-analyses/:id/topics';

const VALID_TOPICS = {
  status: 'completed',
  progress: { phase: 'cluster', percent: 100 },
  clusters: [
    {
      topicName: '線上課程比較',
      parentTopic: '線上學習',
      intentLabel: 'commercial',
      topicType: 'head',
      reason: '高商業意圖群',
      clusterVolume: 42000,
      keywordCount: 12,
      confidence: 0.82,
      representativeKeywords: ['線上課程推薦'],
    },
    {
      topicName: '免費資源',
      parentTopic: '線上學習',
      intentLabel: 'informational',
      topicType: 'tail',
      reason: null,
      clusterVolume: null,
      keywordCount: 3,
      confidence: null,
      representativeKeywords: null,
    },
  ],
  keywords: [
    {
      text: '線上課程推薦',
      normalizedText: '線上課程推薦',
      topicName: '線上課程比較',
      parentTopic: '線上學習',
      intentLabel: 'commercial',
      confidence: 0.9,
      isNoise: false,
    },
  ],
  meta: { runId: 'run-1', snapshotId: 'snap-1', clusterCount: 2, noiseCount: 0 },
};

describe('TC-41 · startTopics (POST :id/topics)', () => {
  it('202 → { ok:true, topicJobId } and forwards the (optional) body verbatim', async () => {
    let received: unknown;
    server.use(
      http.post(POST_PATH, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ topicJobId: 'job-42' }, { status: 202 });
      }),
    );

    const result = await startTopics(ID, { serpEnabled: true, topK: 15 });

    expect(result).toEqual({ ok: true, topicJobId: 'job-42' });
    expect(received).toEqual({ serpEnabled: true, topK: 15 });
  });

  it('202 with no body → sends {} and still validates the job id', async () => {
    let received: unknown;
    server.use(
      http.post(POST_PATH, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ topicJobId: 'job-1' }, { status: 202 });
      }),
    );

    const result = await startTopics(ID);

    expect(result).toEqual({ ok: true, topicJobId: 'job-1' });
    expect(received).toEqual({});
  });

  it('202 but a malformed body (no topicJobId) → ok:false with the status', async () => {
    server.use(http.post(POST_PATH, () => HttpResponse.json({ wrong: 'shape' }, { status: 202 })));

    expect(await startTopics(ID)).toEqual({ ok: false, status: 202 });
  });

  it('non-2xx with an ErrorResponse body → ok:false + status + parsed error', async () => {
    server.use(
      http.post(POST_PATH, () =>
        HttpResponse.json(
          { statusCode: 409, code: 'snapshot_not_ready', message: '請先完成關鍵字分析' },
          { status: 409 },
        ),
      ),
    );

    const result = await startTopics(ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error?.code).toBe('snapshot_not_ready');
    }
  });

  it('non-2xx with a non-ErrorResponse body → ok:false, error undefined', async () => {
    server.use(http.post(POST_PATH, () => HttpResponse.json(['nope'], { status: 404 })));

    const result = await startTopics(ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBeUndefined();
    }
  });
});

describe('TC-41 · fetchTopics (GET :id/topics)', () => {
  it('200 valid TopicsResponse → { ok:true, topics } (null metrics preserved, C12)', async () => {
    server.use(http.get(GET_PATH, () => HttpResponse.json(VALID_TOPICS)));

    const result = await fetchTopics(ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.topics.clusters).toHaveLength(2);
      expect(result.topics.clusters[0].clusterVolume).toBe(42000);
      expect(result.topics.clusters[1].clusterVolume).toBeNull();
      expect(result.topics.clusters[1].confidence).toBeNull();
      expect(result.topics.meta.runId).toBe('run-1');
    }
  });

  it('200 malformed body → ok:false with the status', async () => {
    server.use(
      http.get(GET_PATH, () => HttpResponse.json({ status: 'completed' }, { status: 200 })),
    );

    expect(await fetchTopics(ID)).toEqual({ ok: false, status: 200 });
  });

  it('404 (no run) → ok:false with the status', async () => {
    server.use(http.get(GET_PATH, () => new HttpResponse(null, { status: 404 })));

    expect(await fetchTopics(ID)).toEqual({ ok: false, status: 404 });
  });
});

const TOPICS = {
  status: 'running',
  progress: null,
  clusters: [],
  keywords: [],
  meta: { runId: 'r', snapshotId: 's', clusterCount: null, noiseCount: null },
};

describe('M3-R1 · fetchTopicsStatus (topics-scoped DB status → StatusFetch)', () => {
  it('maps a valid topics run status to { kind: ok }', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id/topics', () =>
        HttpResponse.json({ ...TOPICS, status: 'partial' }),
      ),
    );
    expect(await fetchTopicsStatus('id')).toEqual({ kind: 'ok', status: { status: 'partial' } });
  });

  it('maps a 404 (no topics run) to not_found', async () => {
    server.use(
      http.get(
        '/api/v1/keyword-analyses/:id/topics',
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    expect(await fetchTopicsStatus('id')).toEqual({ kind: 'not_found' });
  });

  it('maps any other non-2xx to unavailable (keep polling)', async () => {
    server.use(
      http.get(
        '/api/v1/keyword-analyses/:id/topics',
        () => new HttpResponse(null, { status: 503 }),
      ),
    );
    expect(await fetchTopicsStatus('id')).toEqual({ kind: 'unavailable' });
  });

  it('maps an unrecognised status string to unavailable', async () => {
    server.use(
      http.get('/api/v1/keyword-analyses/:id/topics', () =>
        HttpResponse.json({ ...TOPICS, status: 'weird' }),
      ),
    );
    expect(await fetchTopicsStatus('id')).toEqual({ kind: 'unavailable' });
  });
});
