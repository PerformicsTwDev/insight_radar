import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../api/msw/server';
import { CustomClassifyModal } from './CustomClassifyModal';

/**
 * TC-26 (stage one) — the 自訂分類 HITL modal (T5.1, FR-16 / backend FR-34). Name +
 * instruction → `生成分類架構` (async, `POST /:id/custom-classifications`) → label
 * chips that ACCUMULATE across generations (dedup, C7) and can be added / removed by
 * hand. `開始分析` is disabled until at least one label exists (no generation → no
 * stage two). The generate trigger is re-entrancy-guarded (M4-R1) so a fast
 * double-click fires exactly ONE POST.
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ROUTE = '/api/v1/keyword-analyses/:id/custom-classifications';

function classification(id: string, labels: string[]) {
  return {
    id,
    name: '競爭優勢',
    instruction: 'i',
    labels: labels.map((label) => ({ label, description: `${label} 描述` })),
    createdAt: '2026-07-21T00:00:00.000Z',
  };
}

/** MSW: reply to the Nth POST with the Nth label set (drives the accumulate test). */
function respondWith(...batches: string[][]): void {
  let call = 0;
  server.use(
    http.post(ROUTE, () => {
      const labels = batches[Math.min(call, batches.length - 1)];
      call += 1;
      return HttpResponse.json(classification(`c${call}`, labels), { status: 201 });
    }),
  );
}

function renderModal(overrides: Partial<Parameters<typeof CustomClassifyModal>[0]> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(
    <CustomClassifyModal analysisId={ID} onClose={onClose} onConfirm={onConfirm} {...overrides} />,
  );
  return { onClose, onConfirm };
}

function fillInputs(name = '競爭優勢', instruction = '請依價格 vs 品質分組'): void {
  fireEvent.change(screen.getByLabelText('分類視角名稱'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('AI 分類指令'), { target: { value: instruction } });
}

function generateBtn(): HTMLElement {
  return screen.getByRole('button', { name: '生成分類架構' });
}

function startBtn(): HTMLElement {
  return screen.getByRole('button', { name: '開始分析' });
}

describe('TC-26 · CustomClassifyModal (stage one)', () => {
  it('disables 生成分類架構 until both name and instruction are non-empty', () => {
    renderModal();
    expect(generateBtn()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('分類視角名稱'), { target: { value: '競爭優勢' } });
    expect(generateBtn()).toBeDisabled(); // name only — still gated

    fireEvent.change(screen.getByLabelText('AI 分類指令'), { target: { value: '請分組' } });
    expect(generateBtn()).toBeEnabled();
  });

  it('name + instruction → 生成分類架構 renders the AI-generated label chips', async () => {
    respondWith(['價格導向', '品質導向']);
    renderModal();
    fillInputs();
    fireEvent.click(generateBtn());

    expect(await screen.findByText('價格導向')).toBeInTheDocument();
    expect(screen.getByText('品質導向')).toBeInTheDocument();
  });

  it('ACCUMULATES AI labels across generations, de-duplicated (C7)', async () => {
    respondWith(['價格導向', '品質導向'], ['品質導向', '售後服務']);
    renderModal();
    fillInputs();

    fireEvent.click(generateBtn());
    await screen.findByText('價格導向');

    fireEvent.click(generateBtn());
    await screen.findByText('售後服務');

    // First-batch chips remain; the overlapping 品質導向 is NOT duplicated.
    expect(screen.getByText('價格導向')).toBeInTheDocument();
    expect(screen.getAllByText('品質導向')).toHaveLength(1);
    expect(screen.getByText('售後服務')).toBeInTheDocument();
  });

  it('lets the user add a label by hand (Enter), de-duplicated against existing chips', async () => {
    respondWith(['價格導向']);
    renderModal();
    fillInputs();
    fireEvent.click(generateBtn());
    await screen.findByText('價格導向');

    const chipInput = screen.getByLabelText('新增標籤');

    // A manual duplicate of an existing chip is dropped (C7 single point).
    fireEvent.change(chipInput, { target: { value: '價格導向' } });
    fireEvent.keyDown(chipInput, { key: 'Enter' });
    expect(screen.getAllByText('價格導向')).toHaveLength(1);

    // A genuinely-new manual label is appended.
    fireEvent.change(chipInput, { target: { value: '售後服務' } });
    fireEvent.keyDown(chipInput, { key: 'Enter' });
    expect(screen.getByText('售後服務')).toBeInTheDocument();
  });

  it('lets the user remove a chip', async () => {
    respondWith(['價格導向', '品質導向']);
    renderModal();
    fillInputs();
    fireEvent.click(generateBtn());
    await screen.findByText('價格導向');

    fireEvent.click(screen.getByRole('button', { name: '移除 價格導向' }));
    expect(screen.queryByText('價格導向')).not.toBeInTheDocument();
    expect(screen.getByText('品質導向')).toBeInTheDocument();
  });

  it('keeps 開始分析 disabled before generation and enables it once a label exists', async () => {
    respondWith(['價格導向']);
    renderModal();
    expect(startBtn()).toBeDisabled();

    fillInputs();
    fireEvent.click(generateBtn());
    await screen.findByText('價格導向');
    expect(startBtn()).toBeEnabled();
  });

  it('re-disables 開始分析 when the last chip is removed', async () => {
    respondWith(['價格導向']);
    renderModal();
    fillInputs();
    fireEvent.click(generateBtn());
    await screen.findByText('價格導向');
    expect(startBtn()).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '移除 價格導向' }));
    expect(startBtn()).toBeDisabled();
  });

  it('hands the confirmed labels to onConfirm when 開始分析 is clicked', async () => {
    respondWith(['價格導向', '品質導向']);
    const { onConfirm } = renderModal();
    fillInputs();
    fireEvent.click(generateBtn());
    await screen.findByText('價格導向');

    fireEvent.click(startBtn());
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ id: 'c1', name: '競爭優勢' }, [
        '價格導向',
        '品質導向',
      ]),
    );
  });

  it('fires exactly ONE POST on a rapid double 生成分類架構 (in-flight guard, M4-R1)', async () => {
    let postCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(ROUTE, async () => {
        postCount += 1;
        await gate; // hold the 201 open so the double-click race window stays open
        return HttpResponse.json(classification('c1', ['價格導向']), { status: 201 });
      }),
    );
    renderModal();
    fillInputs();

    fireEvent.click(generateBtn());
    fireEvent.click(generateBtn()); // re-entry while the first POST is outstanding → no-op
    release();

    expect(await screen.findByText('價格導向')).toBeInTheDocument();
    expect(postCount).toBe(1);
  });

  it('fires onConfirm exactly ONCE on a rapid double 開始分析 (in-flight guard, M4-R1)', async () => {
    // Symmetric to the 生成分類架構 guard: `開始分析` also stays clickable while its
    // async work (onConfirm → stage-two classification, wired at T5.2) is outstanding,
    // so guardStart must collapse a double-click to ONE call. A held-open async
    // onConfirm keeps the flight window open — without the guard the re-entry would
    // launch a duplicate stage-two run.
    respondWith(['價格導向']);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onConfirm = vi.fn(() => gate);
    renderModal({ onConfirm });
    fillInputs();
    fireEvent.click(generateBtn());
    await screen.findByText('價格導向');

    fireEvent.click(startBtn());
    fireEvent.click(startBtn()); // re-entry while the first onConfirm is outstanding → no-op
    release();

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ id: 'c1', name: '競爭優勢' }, [
        '價格導向',
      ]),
    );
  });

  it('shows an error and adds no chips when generation fails (502) — 開始分析 stays disabled', async () => {
    server.use(http.post(ROUTE, () => new HttpResponse(null, { status: 502 })));
    renderModal();
    fillInputs();
    fireEvent.click(generateBtn());

    expect(await screen.findByRole('alert')).toHaveTextContent(/生成/);
    expect(screen.queryByLabelText('新增標籤')).not.toBeInTheDocument();
    expect(startBtn()).toBeDisabled();
  });

  it('calls onClose from the ✕ button', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('is an accessible dialog labelled by its heading', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '新增自訂分類' })).toBeInTheDocument();
  });
});
