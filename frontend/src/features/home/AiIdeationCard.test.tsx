import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../api/msw/server';
import { AI_IDEATION_TEMPLATES } from '../../lib/aiIdeation';
import { AiIdeationCard } from './AiIdeationCard';

/**
 * TC-74 (T7.11, FR-2 修訂 e / FR-20; AC-2.4) — the interactive AI-ideation dropdown.
 * The input opens a 10-template dropdown; picking one fills the input with a 「」-slot
 * prompt; the user types a keyword into 「」; 送出 posts `{ template:<key>, seeds:[「」] }`
 * and hands the generated keywords to `onGenerated`. 送出 is gated on a picked template
 * AND non-empty 「」; a non-2xx surfaces a generic error (no callback).
 */

const FIRST = AI_IDEATION_TEMPLATES[0]; // { id: 'technical_terms', label: '發想「」的專業術語與技術規格' }
const FILLED = '發想「吸塵器」的專業術語與技術規格';

describe('TC-74 · AiIdeationCard (interactive dropdown + 「」 slot)', () => {
  it('opens a 10-template dropdown from the input; 送出 disabled initially', () => {
    render(<AiIdeationCard onGenerated={vi.fn()} />);
    expect(screen.getByRole('button', { name: '送出' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: FIRST.label })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('發想模板'));
    const list = screen.getByRole('list', { name: '發想模板選項' });
    expect(within(list).getAllByRole('button')).toHaveLength(10);
    expect(within(list).getByRole('button', { name: FIRST.label })).toBeInTheDocument();
  });

  it('picking a template fills the 「」-slot prompt; 送出 enables once 「」 has content', () => {
    render(<AiIdeationCard onGenerated={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('發想模板'));
    fireEvent.click(screen.getByRole('button', { name: FIRST.label }));

    const input = screen.getByLabelText<HTMLInputElement>('發想模板');
    expect(input.value).toBe(FIRST.label); // 發想「」的專業術語與技術規格
    expect(screen.getByRole('button', { name: '送出' })).toBeDisabled(); // 「」 empty

    fireEvent.change(input, { target: { value: FILLED } });
    expect(screen.getByRole('button', { name: '送出' })).toBeEnabled();
  });

  it('送出 posts { template, seeds:[「」content] } and hands keywords to onGenerated', async () => {
    let received: unknown;
    server.use(
      http.post('/api/v1/ai-ideation', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ keywords: ['塵蟎機', '手持吸塵器'] }, { status: 200 });
      }),
    );
    const onGenerated = vi.fn();
    render(<AiIdeationCard onGenerated={onGenerated} />);

    fireEvent.click(screen.getByLabelText('發想模板'));
    fireEvent.click(screen.getByRole('button', { name: FIRST.label }));
    fireEvent.change(screen.getByLabelText('發想模板'), { target: { value: FILLED } });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(['塵蟎機', '手持吸塵器']));
    // The 「」 content is the seed; the template is the backend key (T7.11 / FR-35 sync).
    expect(received).toEqual({ template: 'technical_terms', seeds: ['吸塵器'] });
  });

  it('shows a 發想中… state while the request is in flight', async () => {
    server.use(
      http.post('/api/v1/ai-ideation', async () => {
        await delay(30);
        return HttpResponse.json({ keywords: ['x'] }, { status: 200 });
      }),
    );
    render(<AiIdeationCard onGenerated={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('發想模板'));
    fireEvent.click(screen.getByRole('button', { name: FIRST.label }));
    fireEvent.change(screen.getByLabelText('發想模板'), { target: { value: FILLED } });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    // The button label flips to 發想中… while generating, then back.
    expect(await screen.findByText('發想中…')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('發想中…')).not.toBeInTheDocument());
  });

  it('shows a generic error on a non-2xx and does not call onGenerated', async () => {
    server.use(http.post('/api/v1/ai-ideation', () => new HttpResponse(null, { status: 400 })));
    const onGenerated = vi.fn();
    render(<AiIdeationCard onGenerated={onGenerated} />);

    fireEvent.click(screen.getByLabelText('發想模板'));
    fireEvent.click(screen.getByRole('button', { name: FIRST.label }));
    fireEvent.change(screen.getByLabelText('發想模板'), { target: { value: FILLED } });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/發想失敗/);
    expect(onGenerated).not.toHaveBeenCalled();
  });
});
