import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { BulkSelectBar } from './BulkSelectBar';
import { server } from '../../api/msw/server';
import { useSelectionStore } from '../../stores/selectionStore';
import { trackingListErrorMessage } from '../../lib/trackingListError';
import type { KeywordSelection, SelectionItem, TopicSelection } from '../../lib/selection';

/**
 * TC-29 (component; FR-19 / AC-19.1) — the floating bulk bar. It shows「已選 N 項 · 搜尋詞 M
 * 個（已去重）」off the store (topic rows flatten + union-dedupe by normalizedText), offers an
 * add dropdown (existing lists from `GET /tracking-lists`, new list via `POST /tracking-lists`),
 * posts the contract-shaped `AddMembersDto` to `POST /:listId/members`, and clears the selection
 * after a successful add. The add trigger is re-entrancy-guarded (M4-R1) so a fast double-click
 * fires exactly ONE POST. A list layer fixes (geo, language), so a selection spanning mixed
 * contexts cannot seed a new list. All egress is MSW-mocked.
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

function seed(items: SelectionItem[]): void {
  useSelectionStore.setState({ items });
}

function listSummary(name: string, listId: string) {
  return {
    listId,
    name,
    geo: 'TW',
    language: 'zh-TW',
    createdAt: '2026-07-21T00:00:00.000Z',
    memberCount: 1,
  };
}

/**
 * Register `GET /tracking-lists` returning the given summaries (the dropdown source). The
 * first list keeps `LIST_ID` (the click targets asserted on), the rest get unique ids.
 */
function withLists(...names: string[]): void {
  const summaries = names.map((name, idx) =>
    listSummary(name, idx === 0 ? LIST_ID : `${LIST_ID}-${idx}`),
  );
  server.use(http.get(LIST_ROUTE, () => HttpResponse.json(summaries, { status: 200 })));
}

function openDropdown(): void {
  fireEvent.click(screen.getByRole('button', { name: '加入搜尋詞追蹤清單' }));
}

// Faithful backend `ErrorResponse` bodies (NestJS `ConflictException`, tracking-list.service):
// the two 409 causes arrive with the SAME `code:'CONFLICT'`, so only the message splits them.
const CAP_MEMBER_MSG = 'Tracking list member limit reached (max 500)'; // add-members cap (AC-28.7)
const CAP_LIST_MSG = 'Tracking list limit reached (max 20)'; //           create list-count cap (AC-28.7)
const DUP_NAME_MSG = 'Tracking list "dup" already exists'; //             create duplicate name (AC-28.1)

function conflictBody(message: string): Record<string, unknown> {
  return { statusCode: 409, code: 'CONFLICT', message };
}

beforeEach(() => {
  useSelectionStore.setState({ items: [] });
});

describe('TC-29 · BulkSelectBar', () => {
  it('renders 已選 N 項 · 搜尋詞 M 個（已去重）with the deduped count', () => {
    // 2 rows (1 keyword + 1 topic); the topic member "Running Shoes" collapses onto the
    // picked keyword by normalizedText → 搜尋詞 = 2 (running shoes, hiking boots).
    seed([kw('running shoes'), topic('shoes', ['Running Shoes', 'hiking boots'])]);
    render(<BulkSelectBar />);
    expect(screen.getByText('已選 2 項 · 搜尋詞 2 個（已去重）')).toBeInTheDocument();
  });

  it('renders nothing when the selection is empty', () => {
    const { container } = render(<BulkSelectBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists existing tracking lists in the add dropdown, and closes on re-click', async () => {
    seed([kw('a')]);
    withLists('Running shoes', 'Trail shoes');
    render(<BulkSelectBar />);

    openDropdown();
    expect(await screen.findByRole('menuitem', { name: 'Running shoes' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Trail shoes' })).toBeInTheDocument();

    openDropdown(); // re-click closes
    await waitFor(() =>
      expect(screen.queryByRole('menuitem', { name: 'Running shoes' })).not.toBeInTheDocument(),
    );
  });

  it('adds the selection to an existing list (contract-shaped body) then clears', async () => {
    seed([kw('running shoes', 'TW', 'zh-TW'), topic('shoes', ['x'])]);
    withLists('Running shoes');
    let body: unknown;
    let seenListId: string | undefined;
    server.use(
      http.post(MEMBERS_ROUTE, async ({ request, params }) => {
        body = await request.json();
        seenListId = params.listId as string;
        return HttpResponse.json({ memberCount: 2, added: 2 }, { status: 200 });
      }),
    );
    render(<BulkSelectBar />);

    openDropdown();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Running shoes' }));

    await waitFor(() => expect(useSelectionStore.getState().items).toEqual([]));
    expect(seenListId).toBe(LIST_ID);
    expect(body).toEqual({
      items: [
        { kind: 'keyword', text: 'running shoes', geo: 'TW', language: 'zh-TW' },
        { kind: 'topic', analysisId: 'a1', topicName: 'shoes' },
      ],
    });
    // Bar disappears once the selection is cleared.
    expect(screen.queryByText(/已選/)).not.toBeInTheDocument();
  });

  it('creates a new list (fixed geo/language) then adds members and clears', async () => {
    seed([kw('running shoes', 'TW', 'zh-TW')]);
    withLists(); // no existing lists
    let createBody: unknown;
    let memberBody: unknown;
    server.use(
      http.post(LIST_ROUTE, async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json(
          { listId: LIST_ID, name: 'New list', geo: 'TW', language: 'zh-TW', createdAt: 'now' },
          { status: 201 },
        );
      }),
      http.post(MEMBERS_ROUTE, async ({ request }) => {
        memberBody = await request.json();
        return HttpResponse.json({ memberCount: 1, added: 1 }, { status: 200 });
      }),
    );
    render(<BulkSelectBar />);

    openDropdown();
    fireEvent.click(await screen.findByRole('button', { name: '建立新清單' }));
    fireEvent.change(screen.getByLabelText('新清單名稱'), { target: { value: 'New list' } });
    fireEvent.click(screen.getByRole('button', { name: '建立並加入' }));

    await waitFor(() => expect(useSelectionStore.getState().items).toEqual([]));
    expect(createBody).toEqual({ geo: 'TW', language: 'zh-TW', name: 'New list' });
    expect(memberBody).toEqual({
      items: [{ kind: 'keyword', text: 'running shoes', geo: 'TW', language: 'zh-TW' }],
    });
  });

  it('collapses a rapid double add to exactly ONE members POST (in-flight guard, M4-R1)', async () => {
    seed([kw('a')]);
    withLists('Running shoes');
    let postCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(MEMBERS_ROUTE, async () => {
        postCount += 1;
        await gate; // hold the 200 open so the double-click race window stays open
        return HttpResponse.json({ memberCount: 1, added: 1 }, { status: 200 });
      }),
    );
    render(<BulkSelectBar />);

    openDropdown();
    const item = await screen.findByRole('menuitem', { name: 'Running shoes' });
    fireEvent.click(item);
    fireEvent.click(item); // re-entry while the first POST is outstanding → no-op
    release();

    await waitFor(() => expect(useSelectionStore.getState().items).toEqual([]));
    expect(postCount).toBe(1);
  });

  // ── FR-19 / AC-19.1 boundary: bulk-add failures must show CAUSE-differentiated prompts,
  //    reusing the single-source `trackingListErrorMessage` (same classifier as the T5.5 CRUD
  //    view). A generic string — or a create-cap mislabeled「名稱可能重複」— is the bug (M5-R1). ──

  // add-to-existing (`POST /:listId/members`): 400 = geo/language context mismatch, 409 = member
  // cap, 404 = not owner. Each maps to its OWN prompt AND leaves the selection intact on failure.
  it.each([
    { label: '400 geo/language context mismatch', status: 400, body: null as string | null },
    { label: '409 member cap', status: 409, body: CAP_MEMBER_MSG },
    { label: '404 not owner', status: 404, body: null as string | null },
  ])(
    'add-to-existing $label shows its own prompt and keeps the selection',
    async ({ status, body }) => {
      seed([kw('a')]);
      withLists('Running shoes');
      server.use(
        http.post(MEMBERS_ROUTE, () =>
          body === null
            ? new HttpResponse(null, { status })
            : HttpResponse.json(conflictBody(body), { status }),
        ),
      );
      render(<BulkSelectBar />);

      openDropdown();
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Running shoes' }));

      const alert = await screen.findByRole('alert');
      // Exact single-source prompt (delegates to trackingListErrorMessage), NOT a generic string.
      expect(alert).toHaveTextContent(trackingListErrorMessage(status, body ?? undefined));
      expect(alert).not.toHaveTextContent('加入追蹤清單失敗');
      // Selection preserved on failure (nothing cleared).
      expect(useSelectionStore.getState().items).toEqual([kw('a')]);
    },
  );

  // A member-cap 409 must read「上限」— never the name-collision prompt (add has no name concept).
  it('add-to-existing 409 cap reads the cap prompt, never a name-collision prompt', async () => {
    seed([kw('a')]);
    withLists('Running shoes');
    server.use(
      http.post(MEMBERS_ROUTE, () =>
        HttpResponse.json(conflictBody(CAP_MEMBER_MSG), { status: 409 }),
      ),
    );
    render(<BulkSelectBar />);

    openDropdown();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Running shoes' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('上限');
    expect(alert).not.toHaveTextContent('名稱');
  });

  it('surfaces the name-collision prompt (not a cap prompt) when create fails 409 duplicate', async () => {
    seed([kw('a')]);
    withLists();
    let members = 0;
    server.use(
      http.post(LIST_ROUTE, () => HttpResponse.json(conflictBody(DUP_NAME_MSG), { status: 409 })),
      http.post(MEMBERS_ROUTE, () => {
        members += 1;
        return HttpResponse.json({ memberCount: 1, added: 1 }, { status: 200 });
      }),
    );
    render(<BulkSelectBar />);

    openDropdown();
    fireEvent.click(await screen.findByRole('button', { name: '建立新清單' }));
    fireEvent.change(screen.getByLabelText('新清單名稱'), { target: { value: 'dup' } });
    fireEvent.click(screen.getByRole('button', { name: '建立並加入' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(trackingListErrorMessage(409, DUP_NAME_MSG)); // NAME_TAKEN
    expect(alert).not.toHaveTextContent('上限');
    expect(members).toBe(0); // create failed → no member POST fired
    expect(useSelectionStore.getState().items).toEqual([kw('a')]);
  });

  // The mis-diagnosis this M5-R1 fixes: a create COUNT-CAP 409 must NOT read「名稱可能重複」
  // (renaming can never resolve a list-count cap) — it must read the cap prompt.
  it('surfaces the cap prompt — NOT「名稱可能重複」— when create fails 409 count-cap', async () => {
    seed([kw('a')]);
    withLists();
    let members = 0;
    server.use(
      http.post(LIST_ROUTE, () => HttpResponse.json(conflictBody(CAP_LIST_MSG), { status: 409 })),
      http.post(MEMBERS_ROUTE, () => {
        members += 1;
        return HttpResponse.json({ memberCount: 1, added: 1 }, { status: 200 });
      }),
    );
    render(<BulkSelectBar />);

    openDropdown();
    fireEvent.click(await screen.findByRole('button', { name: '建立新清單' }));
    fireEvent.change(screen.getByLabelText('新清單名稱'), { target: { value: 'New list' } });
    fireEvent.click(screen.getByRole('button', { name: '建立並加入' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(trackingListErrorMessage(409, CAP_LIST_MSG)); // CAP_REACHED
    expect(alert).toHaveTextContent('上限');
    expect(alert).not.toHaveTextContent('名稱可能重複');
    expect(alert).not.toHaveTextContent('已存在');
    expect(members).toBe(0);
    expect(useSelectionStore.getState().items).toEqual([kw('a')]);
  });

  it('keeps the selection and shows the member-cap prompt when the created list rejects the add (409 cap)', async () => {
    seed([kw('a')]);
    withLists();
    server.use(
      http.post(LIST_ROUTE, () =>
        HttpResponse.json(
          { listId: LIST_ID, name: 'New list', geo: 'TW', language: 'zh-TW', createdAt: 'now' },
          { status: 201 },
        ),
      ),
      http.post(MEMBERS_ROUTE, () =>
        HttpResponse.json(conflictBody(CAP_MEMBER_MSG), { status: 409 }),
      ),
    );
    render(<BulkSelectBar />);

    openDropdown();
    fireEvent.click(await screen.findByRole('button', { name: '建立新清單' }));
    fireEvent.change(screen.getByLabelText('新清單名稱'), { target: { value: 'New list' } });
    fireEvent.click(screen.getByRole('button', { name: '建立並加入' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(trackingListErrorMessage(409, CAP_MEMBER_MSG)); // CAP_REACHED
    // List got created, but the member add failed → the selection is NOT cleared.
    expect(useSelectionStore.getState().items).toEqual([kw('a')]);
  });

  it('blocks new-list creation when the selection spans mixed geo/language', async () => {
    seed([kw('a', 'TW'), kw('b', 'US')]);
    withLists();
    render(<BulkSelectBar />);

    openDropdown();
    fireEvent.click(await screen.findByRole('button', { name: '建立新清單' }));
    // A list layer fixes (geo, language) — mixed context can't seed one.
    expect(screen.getByRole('button', { name: '建立並加入' })).toBeDisabled();
    expect(screen.getByText(/地區.*語言/)).toBeInTheDocument();
  });

  it('shows an error when the existing lists fail to load', async () => {
    seed([kw('a')]);
    server.use(http.get(LIST_ROUTE, () => new HttpResponse(null, { status: 500 })));
    render(<BulkSelectBar />);

    openDropdown();
    expect(await screen.findByText('清單載入失敗')).toBeInTheDocument();
  });
});
