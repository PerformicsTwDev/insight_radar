import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from './msw/server';
import {
  createBrandProfile,
  getBrandProfile,
  listBrandProfiles,
  removeBrandProfile,
  updateBrandProfile,
} from './brandProfiles';

/**
 * TC-62 (contract; FR-22, backend FR-40). Brand-profile CRUD typed egress: the
 * request body is bound to the generated `CreateBrandProfileDto` (drift → compile
 * error); the (openapi-untyped, #392) response body is zod-validated here against
 * the backend `BrandProfileView`. Name collisions → 409, cross-owner/unknown → 404.
 *
 * The ✦ AI 別名補全 (AC-40.2) has **no dedicated backend endpoint** (undelivered,
 * backend brand-alias-extractor backlog), so the front end ships it as a disabled
 * roadmap affordance (FR-22 revision 2026-07-23) — it is NOT wired to any endpoint,
 * so there is no client egress to contract-test here. The MSW server lifecycle
 * (listen / reset / close) is owned by the global `src/test/setup.ts`.
 */

const PROFILE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function view(id = PROFILE_ID) {
  return {
    id,
    brand: { name: 'Dyson', aliases: ['戴森'], sites: ['https://www.dyson.tw'] },
    competitors: [{ name: 'Shark', aliases: ['夏克'], sites: ['shark.com'] }],
    createdAt: '2026-07-23T00:00:00.000Z',
  };
}

describe('createBrandProfile (POST /brand-profiles)', () => {
  it('sends the typed body and returns the created profile on 201', async () => {
    let received: unknown;
    server.use(
      http.post('/api/v1/brand-profiles', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(view(), { status: 201 });
      }),
    );

    const result = await createBrandProfile({
      brand: { name: 'Dyson', aliases: ['戴森'], sites: ['https://www.dyson.tw'] },
      competitors: [{ name: 'Shark', aliases: ['夏克'], sites: ['shark.com'] }],
    });

    expect(result).toEqual({ ok: true, profile: view() });
    expect(received).toEqual({
      brand: { name: 'Dyson', aliases: ['戴森'], sites: ['https://www.dyson.tw'] },
      competitors: [{ name: 'Shark', aliases: ['夏克'], sites: ['shark.com'] }],
    });
  });

  it('degrades to ok:false on a 409 duplicate name (same owner)', async () => {
    server.use(
      http.post('/api/v1/brand-profiles', () =>
        HttpResponse.json(
          { statusCode: 409, code: 'CONFLICT', message: 'name already exists' },
          { status: 409 },
        ),
      ),
    );
    const result = await createBrandProfile({ brand: { name: 'Dyson' } });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it('surfaces 400 field errors so the caller can render them inline', async () => {
    server.use(
      http.post('/api/v1/brand-profiles', () =>
        HttpResponse.json(
          { statusCode: 400, code: 'VALIDATION', fields: { 'brand.name': ['品牌名為必填'] } },
          { status: 400 },
        ),
      ),
    );
    const result = await createBrandProfile({ brand: { name: '' } });
    expect(result).toMatchObject({ ok: false, status: 400 });
    if (!result.ok) expect(result.error?.fields).toEqual({ 'brand.name': ['品牌名為必填'] });
  });

  it('degrades to ok:false when the 201 body is not a valid BrandProfileView', async () => {
    server.use(
      http.post('/api/v1/brand-profiles', () => HttpResponse.json({ nope: true }, { status: 201 })),
    );
    expect(await createBrandProfile({ brand: { name: 'Dyson' } })).toEqual({
      ok: false,
      status: 201,
    });
  });
});

describe('listBrandProfiles / getBrandProfile / updateBrandProfile / removeBrandProfile', () => {
  it('lists owner-scoped profiles (200)', async () => {
    server.use(
      http.get('/api/v1/brand-profiles', () => HttpResponse.json([view()], { status: 200 })),
    );
    const result = await listBrandProfiles();
    expect(result).toEqual({ ok: true, profiles: [view()] });
  });

  it('degrades to ok:false when the list body is not an array of profiles', async () => {
    server.use(
      http.get('/api/v1/brand-profiles', () => HttpResponse.json({ nope: true }, { status: 200 })),
    );
    expect(await listBrandProfiles()).toMatchObject({ ok: false, status: 200 });
  });

  it('degrades to ok:false when the list request itself fails', async () => {
    server.use(http.get('/api/v1/brand-profiles', () => HttpResponse.json({}, { status: 500 })));
    expect(await listBrandProfiles()).toMatchObject({ ok: false, status: 500 });
  });

  it('fetches one profile (GET :id → 200)', async () => {
    server.use(
      http.get('/api/v1/brand-profiles/:id', () => HttpResponse.json(view(), { status: 200 })),
    );
    expect(await getBrandProfile(PROFILE_ID)).toEqual({ ok: true, profile: view() });
  });

  it('returns 404 for an unknown / cross-owner profile (GET :id)', async () => {
    server.use(
      http.get('/api/v1/brand-profiles/:id', () =>
        HttpResponse.json({ statusCode: 404, message: 'Not Found' }, { status: 404 }),
      ),
    );
    expect(await getBrandProfile(PROFILE_ID)).toMatchObject({ ok: false, status: 404 });
  });

  it('updates a profile (PATCH :id) and returns the new view', async () => {
    let received: unknown;
    server.use(
      http.patch('/api/v1/brand-profiles/:id', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(view(), { status: 200 });
      }),
    );
    const result = await updateBrandProfile(PROFILE_ID, { aliases: ['戴森', 'Dyson TW'] });
    expect(result).toEqual({ ok: true, profile: view() });
    expect(received).toEqual({ aliases: ['戴森', 'Dyson TW'] });
  });

  it('degrades to ok:false when the update collides with an existing name (409)', async () => {
    server.use(
      http.patch('/api/v1/brand-profiles/:id', () =>
        HttpResponse.json({ statusCode: 409, code: 'CONFLICT' }, { status: 409 }),
      ),
    );
    expect(await updateBrandProfile(PROFILE_ID, { name: 'Taken' })).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it('removes a profile (DELETE :id) → true on 200', async () => {
    server.use(
      http.delete('/api/v1/brand-profiles/:id', () =>
        HttpResponse.json({ id: PROFILE_ID }, { status: 200 }),
      ),
    );
    expect(await removeBrandProfile(PROFILE_ID)).toBe(true);
  });
});
