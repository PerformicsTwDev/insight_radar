import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../api/msw/server';
import { CustomClassifyView } from './CustomClassifyView';
import type { EventSourceFactory, EventSourceLike } from '../job/useJobTracking';

/**
 * TC-26 (stage two, T5.2, FR-16 / backend FR-34 · AC-34.2) — the full 自訂分類 stage-two
 * flow: `+ 新增自訂分類` opens the HITL modal → generate labels → 開始分析 fires the
 * assignment job (`POST .../assignments` 202) → the job is tracked over the assignments
 * SSE (`useJobTracking` via an injected fake EventSource) → on completion a dynamic
 * `custom:{cid}` view tab is registered (metadata-driven, T3.1) → the tab is deletable
 * behind a confirm (`DELETE .../{cid}`). The async triggers (start job / confirm delete)
 * are re-entrancy-guarded (M4-R1) so a fast double-click fires exactly ONE request.
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const CID1 = 'c1111111-0000-41d3-9a0c-0305e82c3301';
const CID2 = 'c2222222-0000-41d3-9a0c-0305e82c3302';

/** Controllable fake EventSource (jsdom has none) — records every instance the hook opens. */
class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }
  close(): void {}
  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    (this.listeners.get(type) ?? []).forEach((l) => l(event));
  }
}

const factory: EventSourceFactory = (url) => new FakeEventSource(url);

function esFor(cid: string): FakeEventSource | undefined {
  return FakeEventSource.instances.find((es) => es.url.includes(`/${cid}/assignments/stream`));
}

function classification(id: string, name: string, labels: string[]) {
  return {
    id,
    name,
    instruction: 'i',
    labels: labels.map((l) => ({ label: l, description: `${l} 說明` })),
    createdAt: '2026-07-21T00:00:00.000Z',
  };
}

function emptyTable(cid: string) {
  return {
    view: `custom:${cid}`,
    columns: [{ key: 'text', label: '關鍵字', type: 'text' }],
    rows: [],
    pagination: { total: 0, page: 1, pageSize: 25, cursor: null },
  };
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CustomClassifyView analysisId={ID} eventSourceFactory={factory} />
    </QueryClientProvider>,
  );
}

/** Drive the full stage-two happy path for one classification until its tab appears. */
async function createTab({ cid, name, label }: { cid: string; name: string; label: string }) {
  server.use(
    http.post('/api/v1/keyword-analyses/:id/custom-classifications', () =>
      HttpResponse.json(classification(cid, name, [label]), { status: 201 }),
    ),
    http.post(`/api/v1/keyword-analyses/:id/custom-classifications/${cid}/assignments`, () =>
      HttpResponse.json({ jobId: `run-${cid}` }, { status: 202 }),
    ),
    http.get(`/api/v1/keyword-analyses/:id/custom-classifications/${cid}/assignments`, () =>
      HttpResponse.json({
        jobId: `run-${cid}`,
        status: 'completed',
        progress: null,
        keywordCount: 1,
      }),
    ),
    http.post('/api/v1/keyword-analyses/:id/query', () => HttpResponse.json(emptyTable(cid))),
  );
  fireEvent.click(screen.getByRole('button', { name: '+ 新增自訂分類' }));
  fireEvent.change(screen.getByLabelText('分類視角名稱'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('AI 分類指令'), { target: { value: '請分組' } });
  fireEvent.click(screen.getByRole('button', { name: '生成分類架構' }));
  await screen.findByText(label);
  fireEvent.click(screen.getByRole('button', { name: '開始分析' }));
  await waitFor(() => expect(esFor(cid)).toBeTruthy());
  act(() => esFor(cid)!.emit('completed', { count: 1 }));
  await screen.findByRole('button', { name });
}

beforeEach(() => {
  FakeEventSource.instances = [];
});

describe('TC-26 · CustomClassifyView (stage two)', () => {
  it('renders the add entry and an empty state before any classification', () => {
    renderView();
    expect(screen.getByRole('button', { name: '+ 新增自訂分類' })).toBeInTheDocument();
    expect(screen.getByText(/尚未建立自訂分類/)).toBeInTheDocument();
  });

  it('opening then dismissing the modal (✕) registers no classification', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: '+ 新增自訂分類' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/尚未建立自訂分類/)).toBeInTheDocument();
  });

  it('confirm labels → assignment job → SSE completed → registers a custom:{cid} view tab and renders its 表', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses/:id/custom-classifications', () =>
        HttpResponse.json(classification(CID1, '競爭優勢', ['價格導向']), { status: 201 }),
      ),
      http.post(`/api/v1/keyword-analyses/:id/custom-classifications/${CID1}/assignments`, () =>
        HttpResponse.json({ jobId: `run-${CID1}` }, { status: 202 }),
      ),
      http.get(`/api/v1/keyword-analyses/:id/custom-classifications/${CID1}/assignments`, () =>
        HttpResponse.json({
          jobId: `run-${CID1}`,
          status: 'completed',
          progress: null,
          keywordCount: 2,
        }),
      ),
      http.post('/api/v1/keyword-analyses/:id/query', () =>
        HttpResponse.json({
          view: `custom:${CID1}`,
          columns: [
            { key: 'text', label: '關鍵字', type: 'text' },
            { key: 'label', label: '分類', type: 'text' },
          ],
          rows: [{ text: 'iphone 16', label: '價格導向' }],
          pagination: { total: 1, page: 1, pageSize: 25, cursor: null },
        }),
      ),
    );
    renderView();

    fireEvent.click(screen.getByRole('button', { name: '+ 新增自訂分類' }));
    fireEvent.change(screen.getByLabelText('分類視角名稱'), { target: { value: '競爭優勢' } });
    fireEvent.change(screen.getByLabelText('AI 分類指令'), { target: { value: '請依價格分組' } });
    fireEvent.click(screen.getByRole('button', { name: '生成分類架構' }));
    await screen.findByText('價格導向');

    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));
    // The assignment SSE opens on the (id, cid)-scoped assignments/stream sub-path.
    await waitFor(() => expect(esFor(CID1)).toBeTruthy());
    expect(esFor(CID1)!.url).toContain(
      `/keyword-analyses/${ID}/custom-classifications/${CID1}/assignments/stream`,
    );

    act(() => esFor(CID1)!.emit('completed', { count: 2 }));

    // Dynamic tab registered + its 分類表 rendered off POST /query {view:'custom:{cid}'}.
    await screen.findByRole('button', { name: '競爭優勢' });
    await waitFor(() => expect(screen.getByText('iphone 16')).toBeInTheDocument());
  });

  it('disables + 新增自訂分類 while a classify job is in flight (no pending overwrite)', async () => {
    // Re-entrancy gate: the single `pending` slot tracks one run. A second confirm while
    // the first job is still in flight would overwrite it — dropping the first job's
    // completion/failure tracking so its tab never registers. Serialize: gate the entry
    // while a job is pending (mirrors the journey / ai-intent-batch running gate).
    server.use(
      http.post('/api/v1/keyword-analyses/:id/custom-classifications', () =>
        HttpResponse.json(classification(CID1, '競爭優勢', ['價格導向']), { status: 201 }),
      ),
      http.post(`/api/v1/keyword-analyses/:id/custom-classifications/${CID1}/assignments`, () =>
        HttpResponse.json({ jobId: `run-${CID1}` }, { status: 202 }),
      ),
    );
    renderView();

    fireEvent.click(screen.getByRole('button', { name: '+ 新增自訂分類' }));
    fireEvent.change(screen.getByLabelText('分類視角名稱'), { target: { value: '競爭優勢' } });
    fireEvent.change(screen.getByLabelText('AI 分類指令'), { target: { value: '請分組' } });
    fireEvent.click(screen.getByRole('button', { name: '生成分類架構' }));
    await screen.findByText('價格導向');
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

    // The job is now pending (SSE opened, no `completed` emitted yet) → the entry is gated.
    await waitFor(() => expect(esFor(CID1)).toBeTruthy());
    expect(screen.getByRole('button', { name: '+ 新增自訂分類' })).toBeDisabled();
  });

  it('deletes a tab behind a confirm → DELETE .../{cid} → the tab disappears', async () => {
    renderView();
    await createTab({ cid: CID1, name: '競爭優勢', label: '價格導向' });

    let deleted = false;
    server.use(
      http.delete(`/api/v1/keyword-analyses/:id/custom-classifications/${CID1}`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '刪除 競爭優勢 分類' }));
    // A confirm gate stands between the ✕ and the DELETE (no accidental destructive call).
    expect(screen.getByRole('dialog', { name: '刪除自訂分類' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '競爭優勢' })).not.toBeInTheDocument(),
    );
    expect(deleted).toBe(true);
  });

  it('a delete failure keeps the tab and surfaces an error', async () => {
    renderView();
    await createTab({ cid: CID1, name: '競爭優勢', label: '價格導向' });

    server.use(
      http.delete(
        `/api/v1/keyword-analyses/:id/custom-classifications/${CID1}`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '刪除 競爭優勢 分類' }));
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: '競爭優勢' })).toBeInTheDocument();
  });

  it('cancelling the delete confirm keeps the tab and fires no DELETE', async () => {
    renderView();
    await createTab({ cid: CID1, name: '競爭優勢', label: '價格導向' });

    fireEvent.click(screen.getByRole('button', { name: '刪除 競爭優勢 分類' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('dialog', { name: '刪除自訂分類' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '競爭優勢' })).toBeInTheDocument();
  });

  it('rapid double-click on the confirm 刪除 fires exactly ONE DELETE (in-flight guard, M4-R1)', async () => {
    renderView();
    await createTab({ cid: CID1, name: '競爭優勢', label: '價格導向' });

    let deleteCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.delete(`/api/v1/keyword-analyses/:id/custom-classifications/${CID1}`, async () => {
        deleteCount += 1;
        await gate; // hold the 200 open so the double-click race window stays open
        return new HttpResponse(null, { status: 200 });
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '刪除 競爭優勢 分類' }));
    const confirmBtn = screen.getByRole('button', { name: '刪除' });
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn); // re-entry while the first DELETE is outstanding → no-op
    release();

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '競爭優勢' })).not.toBeInTheDocument(),
    );
    expect(deleteCount).toBe(1);
  });

  it('supports multiple tabs, switches the active view, and re-activates a remaining tab on delete', async () => {
    renderView();
    await createTab({ cid: CID1, name: '競爭優勢', label: '價格導向' });
    await createTab({ cid: CID2, name: '使用情境', label: '居家' });

    const tab1 = screen.getByRole('button', { name: '競爭優勢' });
    const tab2 = screen.getByRole('button', { name: '使用情境' });
    // The just-created tab is active; the earlier one is not.
    expect(tab2).toHaveAttribute('aria-current', 'page');
    expect(tab1).not.toHaveAttribute('aria-current');

    fireEvent.click(tab1);
    expect(tab1).toHaveAttribute('aria-current', 'page');

    server.use(
      http.delete(
        `/api/v1/keyword-analyses/:id/custom-classifications/${CID1}`,
        () => new HttpResponse(null, { status: 200 }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '刪除 競爭優勢 分類' }));
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '競爭優勢' })).not.toBeInTheDocument(),
    );
    // Deleting the active tab activates the remaining one (nextActiveCid).
    expect(screen.getByRole('button', { name: '使用情境' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('an assignment start failure (409) surfaces an error and adds no tab', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses/:id/custom-classifications', () =>
        HttpResponse.json(classification(CID1, '競爭優勢', ['價格導向']), { status: 201 }),
      ),
      http.post(`/api/v1/keyword-analyses/:id/custom-classifications/${CID1}/assignments`, () =>
        HttpResponse.json({ statusCode: 409, code: 'in_progress' }, { status: 409 }),
      ),
    );
    renderView();

    fireEvent.click(screen.getByRole('button', { name: '+ 新增自訂分類' }));
    fireEvent.change(screen.getByLabelText('分類視角名稱'), { target: { value: '競爭優勢' } });
    fireEvent.change(screen.getByLabelText('AI 分類指令'), { target: { value: '請分組' } });
    fireEvent.click(screen.getByRole('button', { name: '生成分類架構' }));
    await screen.findByText('價格導向');
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: '競爭優勢' })).not.toBeInTheDocument();
  });

  it('a failed classify job surfaces an error and adds no tab', async () => {
    server.use(
      http.post('/api/v1/keyword-analyses/:id/custom-classifications', () =>
        HttpResponse.json(classification(CID1, '競爭優勢', ['價格導向']), { status: 201 }),
      ),
      http.post(`/api/v1/keyword-analyses/:id/custom-classifications/${CID1}/assignments`, () =>
        HttpResponse.json({ jobId: `run-${CID1}` }, { status: 202 }),
      ),
    );
    renderView();

    fireEvent.click(screen.getByRole('button', { name: '+ 新增自訂分類' }));
    fireEvent.change(screen.getByLabelText('分類視角名稱'), { target: { value: '競爭優勢' } });
    fireEvent.change(screen.getByLabelText('AI 分類指令'), { target: { value: '請分組' } });
    fireEvent.click(screen.getByRole('button', { name: '生成分類架構' }));
    await screen.findByText('價格導向');
    fireEvent.click(screen.getByRole('button', { name: '開始分析' }));

    await waitFor(() => expect(esFor(CID1)).toBeTruthy());
    act(() => esFor(CID1)!.emit('failed', { error: 'boom' }));

    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: '競爭優勢' })).not.toBeInTheDocument();
  });
});
