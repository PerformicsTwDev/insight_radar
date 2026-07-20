import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { generateCustomLabels } from './customClassifications';
import { server } from './msw/server';

/**
 * TC-26 (contract, stage one) / TC-42 — the custom-classifications egress (T5.1,
 * FR-16 / backend FR-34 · AC-34.1). The typed request carries `{ name, instruction }`;
 * the backend answers 201 with the generated classification
 * `{ id, name, instruction, labels:[{label,description}], createdAt }`. The openapi
 * types both the `CustomClassifyDto` request and the 201 body as `Record<string,
 * never>` / `never` (#392 class), so the body is runtime-zod-validated here (honest
 * parse, not a cast). A 502 (LLM generation failed, AC-34.1 — no half result), 409
 * (snapshot not ready), 404 (unknown/not owner), 400, or an invalid 201 body all
 * degrade to `ok:false` with the status so the modal shows a clean error.
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ROUTE = '/api/v1/keyword-analyses/:id/custom-classifications';
const OK_BODY = {
  id: 'c1f2504e-0000-41d3-9a0c-0305e82c3301',
  name: '競爭優勢',
  instruction: '請依價格 vs 品質分組',
  labels: [
    { label: '價格導向', description: '在意 CP 值與折扣' },
    { label: '品質導向', description: '在意規格與耐用' },
  ],
  createdAt: '2026-07-21T00:00:00.000Z',
};

describe('TC-26 · generateCustomLabels (custom-classifications stage-one egress)', () => {
  it('sends { name, instruction } to :id and returns the generated classification on 201', async () => {
    let received: unknown;
    let seenId: string | undefined;
    server.use(
      http.post(ROUTE, async ({ request, params }) => {
        received = await request.json();
        seenId = params.id as string;
        return HttpResponse.json(OK_BODY, { status: 201 });
      }),
    );

    const result = await generateCustomLabels(ID, {
      name: '競爭優勢',
      instruction: '請依價格 vs 品質分組',
    });

    expect(result).toEqual({ ok: true, classification: OK_BODY });
    expect(received).toEqual({ name: '競爭優勢', instruction: '請依價格 vs 品質分組' });
    expect(seenId).toBe(ID);
  });

  it('maps a 502 (CUSTOM_CLASSIFY generation failed) to ok:false — no half result', async () => {
    server.use(http.post(ROUTE, () => new HttpResponse(null, { status: 502 })));
    const result = await generateCustomLabels(ID, { name: 'n', instruction: 'i' });
    expect(result).toEqual({ ok: false, status: 502 });
  });

  it('maps a 409 (snapshot not ready) to ok:false with the status', async () => {
    server.use(
      http.post(ROUTE, () =>
        HttpResponse.json({ statusCode: 409, code: 'snapshot_not_ready' }, { status: 409 }),
      ),
    );
    const result = await generateCustomLabels(ID, { name: 'n', instruction: 'i' });
    expect(result).toEqual({ ok: false, status: 409 });
  });

  it('maps a 404 (unknown / not owner) to ok:false with the status', async () => {
    server.use(http.post(ROUTE, () => new HttpResponse(null, { status: 404 })));
    const result = await generateCustomLabels(ID, { name: 'n', instruction: 'i' });
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it('degrades to ok:false when the 201 body is not a valid classification shape', async () => {
    // Missing `labels` — a half/absent result must not surface as ok.
    server.use(
      http.post(ROUTE, () =>
        HttpResponse.json({ id: 'c1', name: 'n', instruction: 'i' }, { status: 201 }),
      ),
    );
    const result = await generateCustomLabels(ID, { name: 'n', instruction: 'i' });
    expect(result).toEqual({ ok: false, status: 201 });
  });

  it('degrades to ok:false when the 201 body carries an EMPTY labels array (AC-34.1 — no half result)', async () => {
    // An empty label set is a half/absent classification (nothing to confirm / analyse);
    // the egress contract requires it degrade to ok:false, matching `aiInsight` where an
    // empty `insight` is likewise rejected. Without `labels.min(1)` this leaks as ok:true.
    server.use(
      http.post(ROUTE, () =>
        HttpResponse.json(
          {
            id: 'c1',
            name: 'n',
            instruction: 'i',
            labels: [],
            createdAt: '2026-07-21T00:00:00.000Z',
          },
          { status: 201 },
        ),
      ),
    );
    const result = await generateCustomLabels(ID, { name: 'n', instruction: 'i' });
    expect(result).toEqual({ ok: false, status: 201 });
  });
});
