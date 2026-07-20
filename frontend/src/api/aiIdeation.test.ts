import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { generateIdeas } from './aiIdeation';
import { server } from './msw/server';

/**
 * TC-31 / TC-42 (contract) — AI-ideation egress, now bound to the **generated**
 * op `POST /api/v1/ai-ideation` (`IdeationController_generate`, backend FR-35) on
 * the shared `api` client (T5.3 收斂 — the T1.5 hand-written stub client is gone; a
 * path drift → compile error). The openapi types the `IdeationDto` request as
 * `Record<string, never>` and the 200 body as `never` (#392 class), so the request
 * goes through a `bodySerializer` and the response is runtime-zod-validated here
 * (honest parse, not a cast). The typed request carries `{ template, seeds }`; the
 * 200 body is `{ keywords }`. MSW intercepts the generated path — an unhandled path
 * (a binding drift) would surface as an `onUnhandledRequest: 'error'` failure.
 */

describe('TC-31 · generateIdeas', () => {
  it('sends { template, seeds } (application/json) to the generated op and returns keywords on 200', async () => {
    let received: unknown;
    let contentType: string | null = null;
    server.use(
      http.post('/api/v1/ai-ideation', async ({ request }) => {
        contentType = request.headers.get('content-type');
        received = await request.json();
        return HttpResponse.json({ keywords: ['trail shoes', 'marathon'] }, { status: 200 });
      }),
    );

    const result = await generateIdeas({ template: 'long-tail', seeds: ['running shoes'] });

    expect(result).toEqual({ ok: true, keywords: ['trail shoes', 'marathon'] });
    // TC-42: the `bodySerializer` sends the real body cast-free as JSON (the
    // openapi-gap handling that lets the under-typed `IdeationDto` carry a real payload).
    expect(contentType).toMatch(/application\/json/);
    expect(received).toEqual({ template: 'long-tail', seeds: ['running shoes'] });
  });

  it('returns ok:false with the status on a 400 (unknown template / empty seeds)', async () => {
    server.use(http.post('/api/v1/ai-ideation', () => new HttpResponse(null, { status: 400 })));
    const result = await generateIdeas({ template: 'bogus', seeds: [] });
    expect(result).toEqual({ ok: false, status: 400 });
  });

  it('returns ok:false when the 200 body is not a valid { keywords } shape', async () => {
    server.use(
      http.post('/api/v1/ai-ideation', () =>
        HttpResponse.json({ keywords: 'nope' }, { status: 200 }),
      ),
    );
    const result = await generateIdeas({ template: 'long-tail', seeds: ['x'] });
    expect(result.ok).toBe(false);
  });
});
