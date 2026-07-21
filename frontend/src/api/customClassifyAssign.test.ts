import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  fetchCustomClassifyAssignStatus,
  fetchCustomClassifyRun,
  removeCustomClassification,
  startCustomClassifyAssign,
} from './customClassifyAssign';
import { server } from './msw/server';

/**
 * TC-42 (contract, custom-classify **stage two**) — the assignment-job egress (T5.2,
 * FR-16 / backend FR-34 · AC-34.2). `startCustomClassifyAssign` POSTs the HITL-confirmed
 * `{ labels:[{label,description}] }` and gets 202 `{ jobId }`; `fetchCustomClassifyRun`
 * polls `GET .../assignments` for `{ jobId, status, progress, keywordCount }`;
 * `fetchCustomClassifyAssignStatus` maps that to the shared {@link StatusFetch} for
 * `useJobTracking`; `removeCustomClassification` DELETEs the classification. openapi
 * types every body as `Record<string,never>`/`never` (#392 class), so bodies are
 * zod-validated here (honest parse, not a cast). 404 (unknown/not owner), 409 (empty /
 * in-progress), 413 (over cost guard), or an invalid body all degrade to `ok:false`.
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const CID = 'c1f2504e-0000-41d3-9a0c-0305e82c3301';
const ASSIGN_ROUTE = '/api/v1/keyword-analyses/:id/custom-classifications/:cid/assignments';
const CLS_ROUTE = '/api/v1/keyword-analyses/:id/custom-classifications/:cid';

const RUN_BODY = { jobId: 'run-1', status: 'completed', progress: null, keywordCount: 12 };

describe('TC-42 · startCustomClassifyAssign', () => {
  it('sends { labels:[{label,description}] } to :id/:cid and returns jobId on 202', async () => {
    let received: unknown;
    let seen: { id?: string; cid?: string } = {};
    server.use(
      http.post(ASSIGN_ROUTE, async ({ request, params }) => {
        received = await request.json();
        seen = { id: params.id as string, cid: params.cid as string };
        return HttpResponse.json({ jobId: 'run-1' }, { status: 202 });
      }),
    );

    const result = await startCustomClassifyAssign(ID, CID, ['價格導向', '品質導向']);

    expect(result).toEqual({ ok: true, jobId: 'run-1' });
    // The modal seam carries label strings → the DTO shape `{label, description}` is
    // rebuilt here (description empty; the manual/accumulated chips carry no description).
    expect(received).toEqual({
      labels: [
        { label: '價格導向', description: '' },
        { label: '品質導向', description: '' },
      ],
    });
    expect(seen).toEqual({ id: ID, cid: CID });
  });

  it('maps a 404 (unknown / not owner) to ok:false with the status', async () => {
    server.use(http.post(ASSIGN_ROUTE, () => new HttpResponse(null, { status: 404 })));
    expect(await startCustomClassifyAssign(ID, CID, ['x'])).toEqual({ ok: false, status: 404 });
  });

  it('maps a 409 (empty labels / in-progress run) to ok:false with the status', async () => {
    server.use(
      http.post(ASSIGN_ROUTE, () =>
        HttpResponse.json({ statusCode: 409, code: 'in_progress' }, { status: 409 }),
      ),
    );
    expect(await startCustomClassifyAssign(ID, CID, ['x'])).toEqual({ ok: false, status: 409 });
  });

  it('maps a 413 (over cost guard) to ok:false with the status', async () => {
    server.use(http.post(ASSIGN_ROUTE, () => new HttpResponse(null, { status: 413 })));
    expect(await startCustomClassifyAssign(ID, CID, ['x'])).toEqual({ ok: false, status: 413 });
  });

  it('degrades to ok:false when the 202 body carries no jobId', async () => {
    server.use(http.post(ASSIGN_ROUTE, () => HttpResponse.json({}, { status: 202 })));
    expect(await startCustomClassifyAssign(ID, CID, ['x'])).toEqual({ ok: false, status: 202 });
  });
});

describe('TC-42 · fetchCustomClassifyRun', () => {
  it('returns the run projection on 200', async () => {
    server.use(http.get(ASSIGN_ROUTE, () => HttpResponse.json(RUN_BODY)));
    expect(await fetchCustomClassifyRun(ID, CID)).toEqual({ ok: true, run: RUN_BODY });
  });

  it('preserves a null keywordCount (missing ≠ 0, C12)', async () => {
    server.use(
      http.get(ASSIGN_ROUTE, () =>
        HttpResponse.json({
          jobId: 'run-1',
          status: 'running',
          progress: null,
          keywordCount: null,
        }),
      ),
    );
    const result = await fetchCustomClassifyRun(ID, CID);
    expect(result.ok && result.run.keywordCount).toBeNull();
  });

  it('maps a 404 (no run) to ok:false with the status', async () => {
    server.use(http.get(ASSIGN_ROUTE, () => new HttpResponse(null, { status: 404 })));
    expect(await fetchCustomClassifyRun(ID, CID)).toEqual({ ok: false, status: 404 });
  });

  it('degrades to ok:false when the 200 body is not a valid run shape', async () => {
    server.use(http.get(ASSIGN_ROUTE, () => HttpResponse.json({ jobId: 'run-1' })));
    expect(await fetchCustomClassifyRun(ID, CID)).toEqual({ ok: false, status: 200 });
  });
});

describe('TC-42 · fetchCustomClassifyAssignStatus (→ StatusFetch for useJobTracking)', () => {
  it('maps a completed run to { kind:"ok", status:{status:"completed"} }', async () => {
    server.use(http.get(ASSIGN_ROUTE, () => HttpResponse.json(RUN_BODY)));
    expect(await fetchCustomClassifyAssignStatus(ID, CID)).toEqual({
      kind: 'ok',
      status: { status: 'completed' },
    });
  });

  it('forwards a live progress snapshot so the poll fallback keeps the bar (§7; #643)', async () => {
    server.use(
      http.get(ASSIGN_ROUTE, () =>
        HttpResponse.json({
          ...RUN_BODY,
          status: 'running',
          progress: { phase: 'assigning', percent: 60 },
        }),
      ),
    );
    expect(await fetchCustomClassifyAssignStatus(ID, CID)).toEqual({
      kind: 'ok',
      status: { status: 'running', progress: { phase: 'assigning', percent: 60 } },
    });
  });

  it('maps a 404 (no run) to not_found', async () => {
    server.use(http.get(ASSIGN_ROUTE, () => new HttpResponse(null, { status: 404 })));
    expect(await fetchCustomClassifyAssignStatus(ID, CID)).toEqual({ kind: 'not_found' });
  });

  it('maps a non-404 error to unavailable (keep polling)', async () => {
    server.use(http.get(ASSIGN_ROUTE, () => new HttpResponse(null, { status: 500 })));
    expect(await fetchCustomClassifyAssignStatus(ID, CID)).toEqual({ kind: 'unavailable' });
  });

  it('maps an unrecognised status string to unavailable', async () => {
    server.use(
      http.get(ASSIGN_ROUTE, () =>
        HttpResponse.json({ jobId: 'run-1', status: 'weird', progress: null, keywordCount: 1 }),
      ),
    );
    expect(await fetchCustomClassifyAssignStatus(ID, CID)).toEqual({ kind: 'unavailable' });
  });
});

describe('TC-42 · removeCustomClassification', () => {
  it('DELETEs :cid and returns ok:true on 200', async () => {
    let seen: { id?: string; cid?: string } = {};
    server.use(
      http.delete(CLS_ROUTE, ({ params }) => {
        seen = { id: params.id as string, cid: params.cid as string };
        return new HttpResponse(null, { status: 200 });
      }),
    );
    expect(await removeCustomClassification(ID, CID)).toEqual({ ok: true });
    expect(seen).toEqual({ id: ID, cid: CID });
  });

  it('maps a 404 (unknown / not owner) to ok:false with the status', async () => {
    server.use(http.delete(CLS_ROUTE, () => new HttpResponse(null, { status: 404 })));
    expect(await removeCustomClassification(ID, CID)).toEqual({ ok: false, status: 404 });
  });
});
