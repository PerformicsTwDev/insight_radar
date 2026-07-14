import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { generateIdeas } from './aiIdeation';
import { server } from './msw/server';

/**
 * TC-31 (contract) — AI-ideation stub egress. The real endpoint is backend
 * FR-35 (M12, not yet in openapi), so this stage stubs `/api/v1/ai-ideation` via
 * MSW and validates the body at runtime; T5.3 migrates to the generated client.
 * The typed request carries `{ template, seeds }`; the 200 body is `{ keywords }`.
 */

describe('TC-31 · generateIdeas', () => {
  it('sends { template, seeds } and returns keywords on 200', async () => {
    let received: unknown;
    server.use(
      http.post('/api/v1/ai-ideation', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ keywords: ['trail shoes', 'marathon'] }, { status: 200 });
      }),
    );

    const result = await generateIdeas({ template: 'long-tail', seeds: ['running shoes'] });

    expect(result).toEqual({ ok: true, keywords: ['trail shoes', 'marathon'] });
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
