import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyTsvButton } from './CopyTsvButton';

/**
 * TC-6 (FR-13) — the 複製 button writes the TSV to the clipboard and shows a ✓
 * confirmation. A denied/unavailable clipboard leaves the label unchanged (no ✓).
 */

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

describe('TC-6 · CopyTsvButton', () => {
  it('renders the default 複製表格 label', () => {
    render(<CopyTsvButton getTsv={() => 'a\tb'} />);
    expect(screen.getByRole('button', { name: '複製表格' })).toBeInTheDocument();
  });

  it('accepts a custom label', () => {
    render(<CopyTsvButton getTsv={() => ''} label="複製洞察" />);
    expect(screen.getByRole('button', { name: '複製洞察' })).toBeInTheDocument();
  });

  it('writes the TSV to the clipboard and shows ✓ on click', async () => {
    render(<CopyTsvButton getTsv={() => '詞\t量\nrun\t5'} />);
    fireEvent.click(screen.getByRole('button', { name: '複製表格' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('詞\t量\nrun\t5'));
    expect(await screen.findByText('✓ 已複製')).toBeInTheDocument();
  });

  it('leaves the label unchanged when the clipboard write is denied (no ✓)', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    render(<CopyTsvButton getTsv={() => 'x'} />);
    fireEvent.click(screen.getByRole('button', { name: '複製表格' }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.queryByText('✓ 已複製')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '複製表格' })).toBeInTheDocument();
  });
});
