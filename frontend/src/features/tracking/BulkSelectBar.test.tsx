import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { BulkSelectBar } from './BulkSelectBar';
import { server } from '../../api/msw/server';
import { useSelectionStore } from '../../stores/selectionStore';
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

function listSummary(name: string) {
  return {
    listId: LIST_ID,
    name,
    geo: 'TW',
    language: 'zh-TW',
    createdAt: '2026-07-21T00:00:00.000Z',
    memberCount: 1,
  };
}

/** Register `GET /tracking-lists` returning the given summaries (the dropdown source). */
function withLists(...names: string[]): void {
  server.use(
    http.get(LIST_ROUTE, () => HttpResponse.json(names.map(listSummary), { status: 200 })),
  );
}

function openDropdown(): void {
  fireEvent.click(screen.getByRole('button', { name: '加入搜尋詞追蹤清單' }));
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

  it('shows an error and keeps the selection when the add fails (400 context mismatch)', async () => {
    seed([kw('a')]);
    withLists('Running shoes');
    server.use(http.post(MEMBERS_ROUTE, () => new HttpResponse(null, { status: 400 })));
    render(<BulkSelectBar />);

    openDropdown();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Running shoes' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(useSelectionStore.getState().items).toEqual([kw('a')]);
  });

  it('surfaces an error and adds nothing when creating the new list fails (409 duplicate)', async () => {
    seed([kw('a')]);
    withLists();
    let members = 0;
    server.use(
      http.post(LIST_ROUTE, () => new HttpResponse(null, { status: 409 })),
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

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(members).toBe(0);
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
