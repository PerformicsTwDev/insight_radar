import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SegmentedControl } from './SegmentedControl';

/**
 * TC-19 — reusable accessible segmented control (T3.4). An ARIA `tablist` of
 * focusable `tab` buttons; the parent owns the selected value (controlled) and
 * receives the clicked value via `onChange`.
 */

const OPTIONS = [
  { value: 'table', label: '表格' },
  { value: 'chart', label: '圖表' },
] as const;

describe('TC-19 · SegmentedControl', () => {
  it('renders every option as a tab under a labelled tablist', () => {
    render(
      <SegmentedControl options={OPTIONS} value="table" onChange={() => {}} ariaLabel="檢視方式" />,
    );
    expect(screen.getByRole('tablist', { name: '檢視方式' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '表格' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '圖表' })).toBeInTheDocument();
  });

  it('marks only the selected option as selected', () => {
    render(<SegmentedControl options={OPTIONS} value="chart" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: '圖表' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '表格' })).toHaveAttribute('aria-selected', 'false');
  });

  it('fires onChange with the clicked option value', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTIONS} value="table" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: '圖表' }));
    expect(onChange).toHaveBeenCalledWith('chart');
  });
});
