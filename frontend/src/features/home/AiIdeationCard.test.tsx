import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../api/msw/server';
import { AiIdeationCard } from './AiIdeationCard';

/**
 * TC-31 (card) — the "詢問 AI 輔助發想" sub-card: a 10-template dropdown + 送出.
 * It generates from the **existing seeds already in the form** (passed as the
 * `seeds` prop; FR-20 / AC-20.1 「現有 seeds」 + the mockup's template-picker-only
 * UI — there is no card-local seed field), and hands the generated keywords back
 * to the host via `onGenerated`. No existing seeds → submit is gated; a non-2xx
 * surfaces a generic error; a pulsing state shows while generating.
 */

describe('TC-31 · AiIdeationCard', () => {
  it('renders a 10-option template dropdown and no card-local seed field', () => {
    render(<AiIdeationCard seeds={['running shoes']} onGenerated={vi.fn()} />);
    const select = screen.getByLabelText<HTMLSelectElement>('發想模板');
    expect(select.options).toHaveLength(10);
    expect(screen.queryByLabelText('發想主題')).not.toBeInTheDocument();
  });

  it('gates submit on existing seeds (disabled when empty, enabled once seeds exist)', () => {
    const { rerender } = render(<AiIdeationCard seeds={[]} onGenerated={vi.fn()} />);
    expect(screen.getByRole('button', { name: '送出' })).toBeDisabled();
    rerender(<AiIdeationCard seeds={['running shoes']} onGenerated={vi.fn()} />);
    expect(screen.getByRole('button', { name: '送出' })).toBeEnabled();
  });

  it('submits { template, seeds } from the existing seeds and hands keywords to onGenerated', async () => {
    let received: unknown;
    server.use(
      http.post('/api/v1/ai-ideation', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ keywords: ['trail shoes', 'marathon'] }, { status: 200 });
      }),
    );
    const onGenerated = vi.fn();
    render(<AiIdeationCard seeds={['running shoes', 'sneakers']} onGenerated={onGenerated} />);
    const select = screen.getByLabelText<HTMLSelectElement>('發想模板');
    fireEvent.change(select, { target: { value: select.options[1].value } });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(['trail shoes', 'marathon']));
    expect(received).toEqual({
      template: select.options[1].value,
      seeds: ['running shoes', 'sneakers'],
    });
  });

  it('shows a pulsing "生成中…" state while the request is in flight', async () => {
    server.use(
      http.post('/api/v1/ai-ideation', async () => {
        await delay(30);
        return HttpResponse.json({ keywords: ['x'] }, { status: 200 });
      }),
    );
    render(<AiIdeationCard seeds={['running']} onGenerated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    expect(await screen.findByText('生成中…')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('生成中…')).not.toBeInTheDocument());
  });

  it('shows a generic error on a non-2xx and does not call onGenerated', async () => {
    server.use(http.post('/api/v1/ai-ideation', () => new HttpResponse(null, { status: 400 })));
    const onGenerated = vi.fn();
    render(<AiIdeationCard seeds={['running']} onGenerated={onGenerated} />);
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/發想失敗/);
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it('ignores a form submit while there are no seeds (guard, no request fired)', () => {
    const onGenerated = vi.fn();
    render(<AiIdeationCard seeds={[]} onGenerated={onGenerated} />);
    // Submit the form directly (button is disabled) → guarded early-return; MSW
    // would error on any unhandled request, so a silent pass proves none went out.
    fireEvent.submit(screen.getByRole('form', { name: 'AI 輔助發想' }));
    expect(onGenerated).not.toHaveBeenCalled();
  });
});
