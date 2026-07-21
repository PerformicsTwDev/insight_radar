import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
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

/**
 * TC-24 (NFR-7) — the tablist follows the WAI-ARIA keyboard pattern: a roving
 * tabindex (only the selected tab is in the tab order) and arrow / Home / End keys
 * that move selection and focus together (automatic activation).
 */
describe('TC-24 · SegmentedControl keyboard', () => {
  const OPTS = [
    { value: 'a', label: '甲' },
    { value: 'b', label: '乙' },
    { value: 'c', label: '丙' },
  ] as const;

  function Harness() {
    const [v, setV] = useState<'a' | 'b' | 'c'>('a');
    return <SegmentedControl options={OPTS} value={v} onChange={setV} ariaLabel="檢視" />;
  }

  it('uses a roving tabindex — only the selected tab is tabbable', () => {
    render(<SegmentedControl options={OPTS} value="b" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: '乙' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: '甲' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: '丙' })).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowRight selects and focuses the next tab', () => {
    render(<Harness />);
    const a = screen.getByRole('tab', { name: '甲' });
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    const b = screen.getByRole('tab', { name: '乙' });
    expect(b).toHaveFocus();
    expect(b).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowLeft wraps from the first tab to the last', () => {
    render(<Harness />);
    const a = screen.getByRole('tab', { name: '甲' });
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowLeft' });
    const c = screen.getByRole('tab', { name: '丙' });
    expect(c).toHaveFocus();
    expect(c).toHaveAttribute('aria-selected', 'true');
  });

  it('Home and End jump to the first and last tab', () => {
    render(<Harness />);
    const a = screen.getByRole('tab', { name: '甲' });
    a.focus();
    fireEvent.keyDown(a, { key: 'End' });
    expect(screen.getByRole('tab', { name: '丙' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: '丙' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: '甲' })).toHaveFocus();
  });

  it('leaves selection unchanged on a non-navigation key', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTS} value="a" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: '甲' }), { key: 'x' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
