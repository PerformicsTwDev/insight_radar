import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChipBox } from './ChipBox';

/**
 * TC-26 (chip-box) — the reusable label chip-box behind the 自訂分類 HITL modal
 * (T5.1, FR-16). Presentational only: it renders one removable pill per label and an
 * inline input that emits `onAdd` on Enter; de-dup / accumulate live in the host
 * (single C7 point). Emits `onRemove(label)` from each chip's ✕.
 */

describe('TC-26 · ChipBox', () => {
  it('renders one removable chip per label', () => {
    render(<ChipBox labels={['價格導向', '品質導向']} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('價格導向')).toBeInTheDocument();
    expect(screen.getByText('品質導向')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移除 價格導向' })).toBeInTheDocument();
  });

  it('emits onAdd with the trimmed value on Enter and does not fire for an empty input', () => {
    const onAdd = vi.fn();
    render(<ChipBox labels={[]} onAdd={onAdd} onRemove={vi.fn()} inputAriaLabel="新增標籤" />);
    const input = screen.getByLabelText('新增標籤');

    fireEvent.keyDown(input, { key: 'Enter' }); // empty → no-op
    expect(onAdd).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '  售後服務  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledExactlyOnceWith('售後服務');
  });

  it('does not emit onAdd for a non-Enter key', () => {
    const onAdd = vi.fn();
    render(<ChipBox labels={[]} onAdd={onAdd} onRemove={vi.fn()} inputAriaLabel="新增標籤" />);
    const input = screen.getByLabelText('新增標籤');
    fireEvent.change(input, { target: { value: '售後服務' } });
    fireEvent.keyDown(input, { key: 'a' });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('clears the input after a successful add', () => {
    render(<ChipBox labels={[]} onAdd={vi.fn()} onRemove={vi.fn()} inputAriaLabel="新增標籤" />);
    const input = screen.getByLabelText<HTMLInputElement>('新增標籤');
    fireEvent.change(input, { target: { value: '售後服務' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('');
  });

  it('emits onRemove with the label when a chip ✕ is clicked', () => {
    const onRemove = vi.fn();
    render(<ChipBox labels={['價格導向', '品質導向']} onAdd={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: '移除 品質導向' }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('品質導向');
  });
});
