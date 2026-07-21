import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { TrackingListsView } from './TrackingListsView';
import { server } from '../../api/msw/server';

/**
 * TC-40 (component; FR-19 · backend FR-28 · AC-28.1/28.2/28.3/28.6) — the global
 * tracking-list management view: list · create (name+geo+language) · rename (PATCH
 * `{name}`) · delete (confirm→DELETE) · remove member (confirm→DELETE
 * `/members/{normalizedText}`). Every failure code lands its OWN readable prompt — a
 * duplicate name (409) and a size cap (409) read differently, a context mismatch (400)
 * and a gone/not-owned target (404) each get their own line. The destructive triggers
 * (delete list / remove member) are confirm-gated and re-entrancy-guarded (M4-R1) so a
 * fast double-click fires exactly ONE DELETE. All egress is MSW-mocked.
 */

const LIST_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const LIST_ID_2 = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const LIST_ROUTE = '/api/v1/tracking-lists';
const DETAIL_ROUTE = '/api/v1/tracking-lists/:listId';
const MEMBER_ROUTE = '/api/v1/tracking-lists/:listId/members/:normalizedText';

interface Summary {
  listId: string;
  name: string;
  geo: string;
  language: string;
  createdAt: string;
  memberCount: number;
}

function summary(listId: string, name: string, memberCount = 0): Summary {
  return {
    listId,
    name,
    geo: 'TW',
    language: 'zh-TW',
    createdAt: '2026-07-21T00:00:00.000Z',
    memberCount,
  };
}

/** Register `GET /tracking-lists` off a mutable array (so create/delete can mutate it). */
function withLists(initial: Summary[]): Summary[] {
  const lists = [...initial];
  server.use(http.get(LIST_ROUTE, () => HttpResponse.json(lists, { status: 200 })));
  return lists;
}

function member(normalizedText: string, text: string) {
  return { normalizedText, text, addedAt: '2026-07-21T00:00:00.000Z', lastCheckedAt: null };
}

/** Register `GET /:listId` returning a detail with the given members. */
function withDetail(members: ReturnType<typeof member>[]): void {
  server.use(
    http.get(DETAIL_ROUTE, ({ params }) =>
      HttpResponse.json(
        {
          listId: params.listId,
          name: 'Running shoes',
          geo: 'TW',
          language: 'zh-TW',
          createdAt: '2026-07-21T00:00:00.000Z',
          members,
        },
        { status: 200 },
      ),
    ),
  );
}

beforeEach(() => {
  withLists([]);
});

describe('TC-40 · TrackingListsView', () => {
  it("renders the owner's lists on mount", async () => {
    withLists([summary(LIST_ID, 'Running shoes', 3), summary(LIST_ID_2, 'Trail shoes', 1)]);
    render(<TrackingListsView />);
    expect(await screen.findByText('Running shoes')).toBeInTheDocument();
    expect(screen.getByText('Trail shoes')).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it('shows an error when the lists fail to load', async () => {
    server.use(http.get(LIST_ROUTE, () => new HttpResponse(null, { status: 500 })));
    render(<TrackingListsView />);
    expect(await screen.findByText('清單載入失敗')).toBeInTheDocument();
  });

  it('disables 建立清單 until name, geo and language are all filled', () => {
    render(<TrackingListsView />);
    const create = screen.getByRole('button', { name: '建立清單' });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText('清單名稱'), { target: { value: 'New list' } });
    expect(create).toBeDisabled(); // geo/language still empty
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'TW' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'zh-TW' } });
    expect(create).toBeEnabled();
  });

  it('creates a list (name+geo+language) and shows the new row', async () => {
    let body: unknown;
    server.use(
      http.post(LIST_ROUTE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { listId: LIST_ID, name: 'New list', geo: 'TW', language: 'zh-TW', createdAt: 'now' },
          { status: 201 },
        );
      }),
    );
    render(<TrackingListsView />);
    fireEvent.change(screen.getByLabelText('清單名稱'), { target: { value: 'New list' } });
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'TW' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'zh-TW' } });
    fireEvent.click(screen.getByRole('button', { name: '建立清單' }));

    expect(await screen.findByText('New list')).toBeInTheDocument();
    expect(body).toEqual({ name: 'New list', geo: 'TW', language: 'zh-TW' });
  });

  it('maps a create 409 duplicate name to a name-collision prompt', async () => {
    server.use(
      http.post(LIST_ROUTE, () =>
        HttpResponse.json(
          { statusCode: 409, code: 'CONFLICT', message: 'Tracking list "dup" already exists' },
          { status: 409 },
        ),
      ),
    );
    render(<TrackingListsView />);
    fireEvent.change(screen.getByLabelText('清單名稱'), { target: { value: 'dup' } });
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'TW' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'zh-TW' } });
    fireEvent.click(screen.getByRole('button', { name: '建立清單' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('名稱');
  });

  it('maps a create 409 list cap to a DISTINCT cap prompt', async () => {
    server.use(
      http.post(LIST_ROUTE, () =>
        HttpResponse.json(
          { statusCode: 409, code: 'CONFLICT', message: 'Tracking list limit reached (max 20)' },
          { status: 409 },
        ),
      ),
    );
    render(<TrackingListsView />);
    fireEvent.change(screen.getByLabelText('清單名稱'), { target: { value: 'one more' } });
    fireEvent.change(screen.getByLabelText('地區 (geo)'), { target: { value: 'TW' } });
    fireEvent.change(screen.getByLabelText('語言 (language)'), { target: { value: 'zh-TW' } });
    fireEvent.click(screen.getByRole('button', { name: '建立清單' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('上限');
    expect(alert).not.toHaveTextContent('名稱已存在');
  });

  it('renames a list via PATCH { name } and shows the new name (other rows untouched)', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 2), summary(LIST_ID_2, 'Hiking boots', 5)]);
    let body: unknown;
    server.use(
      http.patch(DETAIL_ROUTE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { listId: LIST_ID, name: 'Trail shoes', geo: 'TW', language: 'zh-TW', createdAt: 'now' },
          { status: 200 },
        );
      }),
    );
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '改名 Running shoes' }));
    fireEvent.change(screen.getByLabelText('重新命名 Running shoes'), {
      target: { value: 'Trail shoes' },
    });
    fireEvent.click(screen.getByRole('button', { name: '儲存名稱' }));

    expect(await screen.findByText('Trail shoes')).toBeInTheDocument();
    expect(screen.getByText('Hiking boots')).toBeInTheDocument(); // the sibling row is unchanged
    expect(body).toEqual({ name: 'Trail shoes' });
  });

  it('cancels an inline rename without a PATCH', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 2)]);
    let patched = 0;
    server.use(
      http.patch(DETAIL_ROUTE, () => {
        patched += 1;
        return HttpResponse.json({ listId: LIST_ID }, { status: 200 });
      }),
    );
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '改名 Running shoes' }));
    fireEvent.change(screen.getByLabelText('重新命名 Running shoes'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    // The inline editor closes and the original row/name stays — no request fired.
    expect(screen.queryByLabelText('重新命名 Running shoes')).not.toBeInTheDocument();
    expect(screen.getByText('Running shoes')).toBeInTheDocument();
    expect(patched).toBe(0);
  });

  it('maps a rename 409 duplicate to a name-collision prompt', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 2)]);
    server.use(
      http.patch(DETAIL_ROUTE, () =>
        HttpResponse.json(
          { statusCode: 409, code: 'CONFLICT', message: 'Tracking list "Trail" already exists' },
          { status: 409 },
        ),
      ),
    );
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '改名 Running shoes' }));
    fireEvent.change(screen.getByLabelText('重新命名 Running shoes'), {
      target: { value: 'Trail' },
    });
    fireEvent.click(screen.getByRole('button', { name: '儲存名稱' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('名稱');
  });

  it('maps a rename 404 to a not-found prompt', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 2)]);
    server.use(http.patch(DETAIL_ROUTE, () => new HttpResponse(null, { status: 404 })));
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '改名 Running shoes' }));
    fireEvent.change(screen.getByLabelText('重新命名 Running shoes'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存名稱' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('找不到');
  });

  it('deletes a list behind a confirm dialog, then removes the row', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 2)]);
    let deleted = 0;
    server.use(
      http.delete(DETAIL_ROUTE, () => {
        deleted += 1;
        return HttpResponse.json({ listId: LIST_ID }, { status: 200 });
      }),
    );
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '刪除 Running shoes' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確定刪除' }));

    await waitFor(() => expect(screen.queryByText('Running shoes')).not.toBeInTheDocument());
    expect(deleted).toBe(1);
  });

  it('closes the member panel when the currently-open list is deleted', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 1)]);
    withDetail([member('running shoes', 'Running Shoes')]);
    server.use(
      http.delete(DETAIL_ROUTE, () => HttpResponse.json({ listId: LIST_ID }, { status: 200 })),
    );
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '檢視 Running shoes 成員' }));
    expect(await screen.findByText('Running Shoes')).toBeInTheDocument(); // panel open

    fireEvent.click(screen.getByRole('button', { name: '刪除 Running shoes' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '確定刪除' }),
    );

    // The list row AND its member panel both go away (selected list was the deleted one).
    await waitFor(() => expect(screen.queryByText('Running shoes')).not.toBeInTheDocument());
    expect(screen.queryByText('Running Shoes')).not.toBeInTheDocument();
  });

  it('does not DELETE when the delete confirm is cancelled', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 2)]);
    let deleted = 0;
    server.use(
      http.delete(DETAIL_ROUTE, () => {
        deleted += 1;
        return HttpResponse.json({ listId: LIST_ID }, { status: 200 });
      }),
    );
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '刪除 Running shoes' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Running shoes')).toBeInTheDocument();
    expect(deleted).toBe(0);
  });

  it('maps a delete 404 to a not-found prompt and keeps the row', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 2)]);
    server.use(http.delete(DETAIL_ROUTE, () => new HttpResponse(null, { status: 404 })));
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '刪除 Running shoes' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '確定刪除' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('找不到');
    expect(screen.getByText('Running shoes')).toBeInTheDocument();
  });

  it('collapses a rapid double delete to exactly ONE DELETE (in-flight guard, M4-R1)', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 2)]);
    let deleted = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.delete(DETAIL_ROUTE, async () => {
        deleted += 1;
        await gate;
        return HttpResponse.json({ listId: LIST_ID }, { status: 200 });
      }),
    );
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '刪除 Running shoes' }));
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', {
      name: '確定刪除',
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm); // re-entry while the first DELETE is outstanding → no-op
    release();

    await waitFor(() => expect(screen.queryByText('Running shoes')).not.toBeInTheDocument());
    expect(deleted).toBe(1);
  });

  it('opens a list detail and removes a member behind a confirm dialog', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 2)]);
    withDetail([member('running shoes', 'Running Shoes'), member('trail shoes', 'Trail Shoes')]);
    let seenMember: string | undefined;
    server.use(
      http.delete(MEMBER_ROUTE, ({ params }) => {
        seenMember = params.normalizedText as string;
        return HttpResponse.json(
          { listId: LIST_ID, normalizedText: 'running shoes' },
          { status: 200 },
        );
      }),
    );
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '檢視 Running shoes 成員' }));
    expect(await screen.findByText('Running Shoes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '移除 Running Shoes' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '確定移除' }),
    );

    await waitFor(() => expect(screen.queryByText('Running Shoes')).not.toBeInTheDocument());
    expect(seenMember).toBe('running shoes');
    expect(screen.getByText('Trail Shoes')).toBeInTheDocument(); // the other member stays
  });

  it('collapses a rapid double member removal to exactly ONE DELETE (in-flight guard, M4-R1)', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 1)]);
    withDetail([member('running shoes', 'Running Shoes')]);
    let deleted = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.delete(MEMBER_ROUTE, async () => {
        deleted += 1;
        await gate;
        return HttpResponse.json(
          { listId: LIST_ID, normalizedText: 'running shoes' },
          { status: 200 },
        );
      }),
    );
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '檢視 Running shoes 成員' }));
    fireEvent.click(await screen.findByRole('button', { name: '移除 Running Shoes' }));
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', {
      name: '確定移除',
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    release();

    await waitFor(() => expect(screen.queryByText('Running Shoes')).not.toBeInTheDocument());
    expect(deleted).toBe(1);
  });

  it('does not DELETE when the remove-member confirm is cancelled', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 1)]);
    withDetail([member('running shoes', 'Running Shoes')]);
    let deleted = 0;
    server.use(
      http.delete(MEMBER_ROUTE, () => {
        deleted += 1;
        return HttpResponse.json(
          { listId: LIST_ID, normalizedText: 'running shoes' },
          { status: 200 },
        );
      }),
    );
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '檢視 Running shoes 成員' }));
    fireEvent.click(await screen.findByRole('button', { name: '移除 Running Shoes' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Running Shoes')).toBeInTheDocument();
    expect(deleted).toBe(0);
  });

  it('maps a remove-member 404 to a not-found prompt', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 1)]);
    withDetail([member('running shoes', 'Running Shoes')]);
    server.use(http.delete(MEMBER_ROUTE, () => new HttpResponse(null, { status: 404 })));
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '檢視 Running shoes 成員' }));
    fireEvent.click(await screen.findByRole('button', { name: '移除 Running Shoes' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '確定移除' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('找不到');
  });

  it('shows an empty-members hint when the opened list has no members', async () => {
    withLists([summary(LIST_ID, 'Empty list', 0)]);
    withDetail([]);
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '檢視 Empty list 成員' }));
    expect(await screen.findByText('此清單尚無成員。')).toBeInTheDocument();
  });

  it('shows an error when a list detail fails to load', async () => {
    withLists([summary(LIST_ID, 'Running shoes', 1)]);
    server.use(http.get(DETAIL_ROUTE, () => new HttpResponse(null, { status: 404 })));
    render(<TrackingListsView />);
    fireEvent.click(await screen.findByRole('button', { name: '檢視 Running shoes 成員' }));
    expect(await screen.findByText('成員載入失敗')).toBeInTheDocument();
  });
});
