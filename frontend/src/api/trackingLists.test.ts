import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  addTrackingMembers,
  createTrackingList,
  deleteTrackingList,
  getTrackingListDetail,
  getTrackingListSeries,
  listTrackingLists,
  refreshTrackingList,
  removeTrackingMember,
  renameTrackingList,
} from './trackingLists';
import { server } from './msw/server';
import type { KeywordSelection, TopicSelection } from '../lib/selection';

/**
 * TC-29 (contract, egress; FR-19 / backend FR-28 · AC-28.1/28.3/28.4/28.5) — the
 * tracking-list egress the bulk bar drives. `GET /tracking-lists` → the dropdown's
 * existing lists; `POST /tracking-lists` → a new list fixed at (geo, language); `POST
 * /:listId/members` sends `AddMembersDto` where a keyword carries text+geo+language and
 * a topic carries analysisId+topicName. openapi types every response body as `never`
 * (#392 class), so bodies are zod-validated here (honest parse, not a cast); a context
 * mismatch (400), a duplicate name (409), a non-owner (404), or an invalid body all
 * degrade to `ok:false` with the status.
 */

const LIST_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const LIST_ROUTE = '/api/v1/tracking-lists';
const MEMBERS_ROUTE = '/api/v1/tracking-lists/:listId/members';

const kw = (text: string, geo = 'TW', language = 'zh-TW'): KeywordSelection => ({
  kind: 'keyword',
  text,
  geo,
  language,
});
const topic = (topicName: string, members: string[]): TopicSelection => ({
  kind: 'topic',
  analysisId: 'a1',
  topicName,
  geo: 'TW',
  language: 'zh-TW',
  members,
});

describe('TC-29 · listTrackingLists (GET /tracking-lists)', () => {
  it('returns the parsed list summaries on 200', async () => {
    const lists = [
      {
        listId: LIST_ID,
        name: 'Running shoes',
        geo: 'TW',
        language: 'zh-TW',
        createdAt: '2026-07-21T00:00:00.000Z',
        memberCount: 3,
      },
    ];
    server.use(http.get(LIST_ROUTE, () => HttpResponse.json(lists, { status: 200 })));
    const res = await listTrackingLists();
    expect(res).toEqual({ ok: true, lists });
  });

  it('degrades to ok:false on a non-2xx', async () => {
    server.use(http.get(LIST_ROUTE, () => new HttpResponse(null, { status: 401 })));
    expect(await listTrackingLists()).toEqual({ ok: false, status: 401 });
  });

  it('degrades to ok:false when the body is not an array of summaries', async () => {
    server.use(http.get(LIST_ROUTE, () => HttpResponse.json({ nope: true }, { status: 200 })));
    expect(await listTrackingLists()).toEqual({ ok: false, status: 200 });
  });
});

describe('TC-29 · createTrackingList (POST /tracking-lists)', () => {
  it('sends { geo, language, name } and returns the created list on 201', async () => {
    let received: unknown;
    const created = {
      listId: LIST_ID,
      name: 'Trail shoes',
      geo: 'TW',
      language: 'zh-TW',
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    server.use(
      http.post(LIST_ROUTE, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    const res = await createTrackingList({ geo: 'TW', language: 'zh-TW', name: 'Trail shoes' });
    expect(res).toEqual({ ok: true, list: created });
    expect(received).toEqual({ geo: 'TW', language: 'zh-TW', name: 'Trail shoes' });
  });

  it('maps a 409 (duplicate name) to ok:false with the status', async () => {
    server.use(http.post(LIST_ROUTE, () => new HttpResponse(null, { status: 409 })));
    expect(await createTrackingList({ geo: 'TW', language: 'zh-TW', name: 'dup' })).toEqual({
      ok: false,
      status: 409,
    });
  });

  it('degrades to ok:false when the 201 body is not a valid list', async () => {
    server.use(http.post(LIST_ROUTE, () => HttpResponse.json({ name: 'x' }, { status: 201 })));
    expect(await createTrackingList({ geo: 'TW', language: 'zh-TW', name: 'x' })).toEqual({
      ok: false,
      status: 201,
    });
  });
});

describe('TC-29 · addTrackingMembers (POST /:listId/members)', () => {
  it('sends AddMembersDto with keyword text+geo+language and topic analysisId+topicName', async () => {
    let received: unknown;
    let seenListId: string | undefined;
    server.use(
      http.post(MEMBERS_ROUTE, async ({ request, params }) => {
        received = await request.json();
        seenListId = params.listId as string;
        return HttpResponse.json({ memberCount: 5, added: 2 }, { status: 200 });
      }),
    );
    const res = await addTrackingMembers(LIST_ID, [
      kw('running shoes', 'TW', 'zh-TW'),
      topic('shoes', ['x']),
    ]);
    expect(res).toEqual({ ok: true, result: { memberCount: 5, added: 2 } });
    expect(seenListId).toBe(LIST_ID);
    expect(received).toEqual({
      items: [
        { kind: 'keyword', text: 'running shoes', geo: 'TW', language: 'zh-TW' },
        { kind: 'topic', analysisId: 'a1', topicName: 'shoes' },
      ],
    });
  });

  it('maps a 400 (geo/language context mismatch) to ok:false with the status', async () => {
    server.use(http.post(MEMBERS_ROUTE, () => new HttpResponse(null, { status: 400 })));
    expect(await addTrackingMembers(LIST_ID, [kw('a')])).toEqual({ ok: false, status: 400 });
  });

  it('maps a 404 (unknown / not owner) to ok:false with the status', async () => {
    server.use(http.post(MEMBERS_ROUTE, () => new HttpResponse(null, { status: 404 })));
    expect(await addTrackingMembers(LIST_ID, [kw('a')])).toEqual({ ok: false, status: 404 });
  });

  it('degrades to ok:false when the 200 body is not a valid result', async () => {
    server.use(http.post(MEMBERS_ROUTE, () => HttpResponse.json({ added: 'x' }, { status: 200 })));
    expect(await addTrackingMembers(LIST_ID, [kw('a')])).toEqual({ ok: false, status: 200 });
  });
});

const DETAIL_ROUTE = '/api/v1/tracking-lists/:listId';
const MEMBER_ROUTE = '/api/v1/tracking-lists/:listId/members/:normalizedText';

describe('TC-40 · getTrackingListDetail (GET /:listId)', () => {
  it('returns the parsed detail (metadata + members) on 200', async () => {
    const detail = {
      listId: LIST_ID,
      name: 'Running shoes',
      geo: 'TW',
      language: 'zh-TW',
      createdAt: '2026-07-21T00:00:00.000Z',
      members: [
        {
          normalizedText: 'running shoes',
          text: 'Running Shoes',
          addedAt: '2026-07-21T00:00:00.000Z',
          lastCheckedAt: null,
        },
      ],
    };
    server.use(http.get(DETAIL_ROUTE, () => HttpResponse.json(detail, { status: 200 })));
    expect(await getTrackingListDetail(LIST_ID)).toEqual({ ok: true, detail });
  });

  it('maps a 404 (unknown / not owner) to ok:false with the status', async () => {
    server.use(http.get(DETAIL_ROUTE, () => new HttpResponse(null, { status: 404 })));
    expect(await getTrackingListDetail(LIST_ID)).toEqual({ ok: false, status: 404 });
  });

  it('degrades to ok:false when the 200 body is not a valid detail', async () => {
    server.use(http.get(DETAIL_ROUTE, () => HttpResponse.json({ name: 'x' }, { status: 200 })));
    expect(await getTrackingListDetail(LIST_ID)).toEqual({ ok: false, status: 200 });
  });
});

describe('TC-40 · renameTrackingList (PATCH /:listId)', () => {
  it('sends { name } and returns the renamed list on 200', async () => {
    let received: unknown;
    let method: string | undefined;
    const renamed = {
      listId: LIST_ID,
      name: 'Trail shoes',
      geo: 'TW',
      language: 'zh-TW',
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    server.use(
      http.patch(DETAIL_ROUTE, async ({ request }) => {
        method = request.method;
        received = await request.json();
        return HttpResponse.json(renamed, { status: 200 });
      }),
    );
    const res = await renameTrackingList(LIST_ID, 'Trail shoes');
    expect(res).toEqual({ ok: true, list: renamed });
    expect(method).toBe('PATCH');
    expect(received).toEqual({ name: 'Trail shoes' });
  });

  it('carries the ErrorResponse body on a 409 duplicate name (for message disambiguation)', async () => {
    server.use(
      http.patch(DETAIL_ROUTE, () =>
        HttpResponse.json(
          { statusCode: 409, code: 'CONFLICT', message: 'Tracking list "Trail" already exists' },
          { status: 409 },
        ),
      ),
    );
    const res = await renameTrackingList(LIST_ID, 'Trail');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
      expect(res.error?.message).toBe('Tracking list "Trail" already exists');
    }
  });

  it('maps a 404 (not owner) to ok:false with the status', async () => {
    server.use(http.patch(DETAIL_ROUTE, () => new HttpResponse(null, { status: 404 })));
    expect(await renameTrackingList(LIST_ID, 'x')).toEqual({ ok: false, status: 404 });
  });

  it('degrades to ok:false when the 200 body is not a valid list', async () => {
    server.use(http.patch(DETAIL_ROUTE, () => HttpResponse.json({ name: 'x' }, { status: 200 })));
    expect(await renameTrackingList(LIST_ID, 'x')).toEqual({ ok: false, status: 200 });
  });
});

describe('TC-40 · deleteTrackingList (DELETE /:listId)', () => {
  it('resolves ok on 200', async () => {
    let method: string | undefined;
    server.use(
      http.delete(DETAIL_ROUTE, ({ request }) => {
        method = request.method;
        return HttpResponse.json({ listId: LIST_ID }, { status: 200 });
      }),
    );
    expect(await deleteTrackingList(LIST_ID)).toEqual({ ok: true });
    expect(method).toBe('DELETE');
  });

  it('maps a 404 (not owner) to ok:false with the status', async () => {
    server.use(http.delete(DETAIL_ROUTE, () => new HttpResponse(null, { status: 404 })));
    expect(await deleteTrackingList(LIST_ID)).toEqual({ ok: false, status: 404 });
  });
});

describe('TC-40 · removeTrackingMember (DELETE /:listId/members/:normalizedText)', () => {
  it('targets /:listId/members/:normalizedText and resolves ok on 200', async () => {
    let seenListId: string | undefined;
    let seenMember: string | undefined;
    server.use(
      http.delete(MEMBER_ROUTE, ({ params }) => {
        seenListId = params.listId as string;
        seenMember = params.normalizedText as string;
        return HttpResponse.json(
          { listId: LIST_ID, normalizedText: 'running shoes' },
          { status: 200 },
        );
      }),
    );
    expect(await removeTrackingMember(LIST_ID, 'running shoes')).toEqual({ ok: true });
    expect(seenListId).toBe(LIST_ID);
    expect(seenMember).toBe('running shoes');
  });

  it('maps a 404 (member / list not found) to ok:false with the status', async () => {
    server.use(http.delete(MEMBER_ROUTE, () => new HttpResponse(null, { status: 404 })));
    expect(await removeTrackingMember(LIST_ID, 'gone')).toEqual({ ok: false, status: 404 });
  });
});

const SERIES_ROUTE = '/api/v1/tracking-lists/:listId/series';
const REFRESH_ROUTE = '/api/v1/tracking-lists/:listId/refresh';

/** A valid backend `VolumeSeriesResult` wire body (dates ISO, cpc single-valued). */
const seriesBody = {
  list: { listId: LIST_ID, name: 'Running shoes', geo: 'TW', language: 'zh-TW' },
  axis: ['2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'],
  total: [100, 140],
  members: [
    {
      normalizedText: 'running shoes',
      text: 'Running Shoes',
      addedAt: '2026-01-01T00:00:00.000Z',
      lastCheckedAt: '2026-03-01T00:00:00.000Z',
      latest: {
        fetchedAt: '2026-03-01T00:00:00.000Z',
        avgMonthlySearches: 140,
        competition: 'HIGH',
        cpc: 1.25,
      },
      series: [
        {
          fetchedAt: '2026-01-01T00:00:00.000Z',
          avgMonthlySearches: 100,
          competition: 'HIGH',
          cpc: 1.1,
        },
        {
          fetchedAt: '2026-03-01T00:00:00.000Z',
          avgMonthlySearches: 140,
          competition: 'HIGH',
          cpc: 1.25,
        },
      ],
    },
  ],
  summary: { memberCount: 1, latestFetchedAt: '2026-03-01T00:00:00.000Z' },
};

describe('TC-30 · getTrackingListSeries (GET /:listId/series?from&to)', () => {
  it('returns the parsed series on 200 and forwards from/to as query params', async () => {
    let seenUrl: URL | undefined;
    server.use(
      http.get(SERIES_ROUTE, ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json(seriesBody, { status: 200 });
      }),
    );
    const res = await getTrackingListSeries(LIST_ID, {
      from: '2025-07-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
    expect(res).toEqual({ ok: true, series: seriesBody });
    expect(seenUrl?.searchParams.get('from')).toBe('2025-07-01T00:00:00.000Z');
    expect(seenUrl?.searchParams.get('to')).toBe('2026-07-01T00:00:00.000Z');
  });

  it('omits the query params entirely when no range is given', async () => {
    let seenUrl: URL | undefined;
    server.use(
      http.get(SERIES_ROUTE, ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json(seriesBody, { status: 200 });
      }),
    );
    expect(await getTrackingListSeries(LIST_ID)).toEqual({ ok: true, series: seriesBody });
    expect(seenUrl?.searchParams.has('from')).toBe(false);
    expect(seenUrl?.searchParams.has('to')).toBe(false);
  });

  it('maps a 404 (unknown / not owner) to ok:false with the status', async () => {
    server.use(http.get(SERIES_ROUTE, () => new HttpResponse(null, { status: 404 })));
    expect(await getTrackingListSeries(LIST_ID)).toEqual({ ok: false, status: 404 });
  });

  it('degrades to ok:false when the 200 body is not a valid series', async () => {
    server.use(http.get(SERIES_ROUTE, () => HttpResponse.json({ axis: 'nope' }, { status: 200 })));
    expect(await getTrackingListSeries(LIST_ID)).toEqual({ ok: false, status: 200 });
  });
});

describe('TC-30 · refreshTrackingList (POST /:listId/refresh)', () => {
  it('resolves ok on a 202 queued', async () => {
    let method: string | undefined;
    server.use(
      http.post(REFRESH_ROUTE, ({ request }) => {
        method = request.method;
        return HttpResponse.json({ status: 'queued', listId: LIST_ID }, { status: 202 });
      }),
    );
    expect(await refreshTrackingList(LIST_ID)).toEqual({ ok: true });
    expect(method).toBe('POST');
  });

  it('maps a 404 (unknown / not owner) to ok:false with the status', async () => {
    server.use(http.post(REFRESH_ROUTE, () => new HttpResponse(null, { status: 404 })));
    expect(await refreshTrackingList(LIST_ID)).toEqual({ ok: false, status: 404 });
  });
});
