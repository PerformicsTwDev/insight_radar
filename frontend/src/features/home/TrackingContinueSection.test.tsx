import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../api/msw/server';
import { TrackingContinueSection } from './TrackingContinueSection';

/**
 * TC-71 — the "從追蹤清單繼續" home entry region (T7.7, FR-2 AC-2.3 / FR-19). Cards
 * carry NAME + `N 個字詞` only (no geo / volume / sparkline — the summary contract has
 * no aggregate volume, so none is faked); top-N + 查看更多; 繼續 loads a list's members
 * as seeds + its list-fixed geo/language; nothing to continue → the section is hidden
 * (not drawn empty). `config.trackingContinueTopN` defaults to 3 in tests.
 */

const CREATED = '2026-07-01T00:00:00.000Z';

function summary(over: Record<string, unknown> = {}) {
  return {
    listId: 'l1',
    name: 'List',
    geo: 'TW',
    language: 'zh-TW',
    createdAt: CREATED,
    memberCount: 5,
    ...over,
  };
}

function member(normalizedText: string) {
  return { normalizedText, text: normalizedText, addedAt: CREATED, lastCheckedAt: null };
}

function stubLists(lists: ReturnType<typeof summary>[]) {
  server.use(http.get('/api/v1/tracking-lists', () => HttpResponse.json(lists)));
}

function renderSection() {
  const onContinue = vi.fn();
  const onSeeMore = vi.fn();
  render(<TrackingContinueSection onContinue={onContinue} onSeeMore={onSeeMore} />);
  return { onContinue, onSeeMore };
}

describe('TC-71 · TrackingContinueSection (從追蹤清單繼續)', () => {
  it('renders a card (名稱 + N 個字詞) per list, top-N + 查看更多 with the remaining count', async () => {
    stubLists([
      summary({ listId: 'a', name: '競品觀察清單', memberCount: 42 }),
      summary({ listId: 'b', name: 'Q3 核心字', memberCount: 28 }),
      summary({ listId: 'c', name: '租屋族痛點字庫', memberCount: 35 }),
      summary({ listId: 'd', name: '第四清單', memberCount: 10 }),
      summary({ listId: 'e', name: '第五清單', memberCount: 7 }),
    ]);
    renderSection();

    expect(await screen.findByRole('heading', { name: '從追蹤清單繼續' })).toBeInTheDocument();
    // top-N = 3 → only the first three cards render.
    expect(screen.getByText('競品觀察清單')).toBeInTheDocument();
    expect(screen.getByText('Q3 核心字')).toBeInTheDocument();
    expect(screen.getByText('租屋族痛點字庫')).toBeInTheDocument();
    expect(screen.queryByText('第四清單')).not.toBeInTheDocument();
    // 字詞數 (no geo / no volume shown).
    expect(screen.getByText('42 個字詞')).toBeInTheDocument();
    expect(screen.queryByText('TW')).not.toBeInTheDocument();
    // 查看更多 with the remaining count (5 - 3 = 2).
    expect(screen.getByRole('button', { name: /查看更多 \(2\)/ })).toBeInTheDocument();
  });

  it('is hidden (renders nothing) when the owner has no tracking lists', async () => {
    stubLists([]);
    const { onContinue } = renderSection();
    // Give the fetch a tick to resolve, then assert nothing rendered.
    await waitFor(() => expect(onContinue).not.toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: '從追蹤清單繼續' })).not.toBeInTheDocument();
  });

  it('is hidden when GET /tracking-lists fails (not drawn empty / faked)', async () => {
    server.use(http.get('/api/v1/tracking-lists', () => new HttpResponse(null, { status: 500 })));
    renderSection();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '從追蹤清單繼續' })).not.toBeInTheDocument(),
    );
  });

  it('繼續 loads the list members as seeds + list-fixed geo/language', async () => {
    stubLists([
      summary({ listId: 'a', name: '競品觀察清單', geo: 'US', language: 'en', memberCount: 2 }),
    ]);
    server.use(
      http.get('/api/v1/tracking-lists/a', () =>
        HttpResponse.json({
          listId: 'a',
          name: '競品觀察清單',
          geo: 'US',
          language: 'en',
          createdAt: CREATED,
          members: [member('dyson 吸塵器'), member('小米吸塵器')],
        }),
      ),
    );
    const { onContinue } = renderSection();

    fireEvent.click(await screen.findByRole('button', { name: '從「競品觀察清單」繼續' }));

    await waitFor(() =>
      expect(onContinue).toHaveBeenCalledWith(['dyson 吸塵器', '小米吸塵器'], 'US', 'en'),
    );
  });

  it('guards against a concurrent second fetch while one 繼續 is in flight (M7-R10)', async () => {
    stubLists([
      summary({ listId: 'a', name: '清單A', memberCount: 2 }),
      summary({ listId: 'b', name: '清單B', memberCount: 2 }),
    ]);
    let calls = 0;
    server.use(
      http.get('/api/v1/tracking-lists/:id', async () => {
        calls += 1;
        await delay('infinite'); // first fetch stays in flight
        return HttpResponse.json({});
      }),
    );
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: '從「清單A」繼續' }));
    await waitFor(() => expect(calls).toBe(1)); // A's detail fetch fired
    fireEvent.click(screen.getByRole('button', { name: '從「清單B」繼續' }));
    await Promise.resolve();
    expect(calls).toBe(1); // B's click is ignored while A is in flight — no duplicate fetch
  });

  it('leaves the form untouched when 繼續 fails to load the members', async () => {
    stubLists([summary({ listId: 'a', name: '競品觀察清單', memberCount: 2 })]);
    server.use(http.get('/api/v1/tracking-lists/a', () => new HttpResponse(null, { status: 500 })));
    const { onContinue } = renderSection();

    const cta = await screen.findByRole('button', { name: '從「競品觀察清單」繼續' });
    fireEvent.click(cta);
    // The detail read fails → the button re-enables and onContinue is never called
    // (spec: 載入 members 失敗 → 不改動現有 seeds).
    await waitFor(() => expect(cta).toBeEnabled());
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('disables 繼續 for a list with zero members', async () => {
    stubLists([summary({ listId: 'a', name: '空清單', memberCount: 0 })]);
    renderSection();
    expect(await screen.findByRole('button', { name: '從「空清單」繼續' })).toBeDisabled();
    expect(screen.getByText('清單無字詞')).toBeInTheDocument();
  });

  it('查看更多 invokes onSeeMore (navigate to /tracking)', async () => {
    stubLists([
      summary({ listId: 'a', name: 'A' }),
      summary({ listId: 'b', name: 'B' }),
      summary({ listId: 'c', name: 'C' }),
      summary({ listId: 'd', name: 'D' }),
    ]);
    const { onSeeMore } = renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /查看更多/ }));
    expect(onSeeMore).toHaveBeenCalledTimes(1);
  });
});
