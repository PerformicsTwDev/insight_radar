import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { addTrackingMembers, createTrackingList, listTrackingLists } from './trackingLists';
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
