import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SparklineCell } from './SparklineCell';
import { EM_DASH } from '../../lib/keywordsTable';
import type { MonthlyVolumePoint } from '../../lib/sparkline';

/**
 * TC-7 (SVG cell) — the sparkline renders self-drawn `<polyline>` segments from
 * the pure geometry; a null month becomes a visible break (two segments), never
 * a dip-to-zero (C12); < 2 non-null points / all-null / empty → an accessible
 * 無趨勢資料 marker (`—`), not a flat 0 line.
 */
const vol = (searches: number | null): MonthlyVolumePoint => ({ searches });

describe('TC-7 · SparklineCell (polyline segments, null-gap breaks, no 0 line)', () => {
  it('renders one accessible polyline for a fully-present series', () => {
    const { container } = render(<SparklineCell volumes={[vol(10), vol(20), vol(30)]} />);
    expect(screen.getByRole('img', { name: '搜尋趨勢走勢' })).toBeInTheDocument();
    expect(container.querySelectorAll('polyline')).toHaveLength(1);
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });

  it('splits into two polylines across a null month (a real gap, never a 0 point)', () => {
    const { container } = render(
      <SparklineCell volumes={[vol(10), vol(20), vol(null), vol(40), vol(50)]} />,
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
  });

  it('draws isolated non-null points (single-point segments) as dots, not lines', () => {
    // 10, null, 30 → two segments of one point each → two dots either side of the gap.
    const { container } = render(<SparklineCell volumes={[vol(10), vol(null), vol(30)]} />);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
  });

  it('strokes the line with the brand token, never a hardcoded hex', () => {
    const { container } = render(<SparklineCell volumes={[vol(10), vol(20)]} />);
    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('class')).toContain('stroke-brand');
    expect(polyline?.getAttribute('fill')).toBe('none');
  });

  it('renders the 無趨勢資料 marker (—) for a single non-null point (never a 0 line)', () => {
    const { container } = render(<SparklineCell volumes={[vol(42)]} />);
    const marker = screen.getByRole('img', { name: '無趨勢資料' });
    expect(marker).toHaveTextContent(EM_DASH);
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });

  it('renders 無趨勢資料 for an all-null series (never補 0)', () => {
    render(<SparklineCell volumes={[vol(null), vol(null)]} />);
    expect(screen.getByRole('img', { name: '無趨勢資料' })).toBeInTheDocument();
  });

  it('renders 無趨勢資料 for an empty series (backend emitted [])', () => {
    render(<SparklineCell volumes={[]} />);
    expect(screen.getByRole('img', { name: '無趨勢資料' })).toBeInTheDocument();
  });
});

describe('TC-7+21 · SparklineCell FR-21 trend hover tooltip (型別 + %)', () => {
  it('shows the trend type + % as an SVG <title> for a classifiable series', () => {
    // 100 → 200 = +100% → surge (爆發型); classifySeries uses config thresholds.
    const { container } = render(<SparklineCell volumes={[vol(100), vol(200)]} />);
    expect(container.querySelector('title')?.textContent).toBe('爆發型 +100.0%');
  });

  it('omits the trend <title> when the series has no classifiable trend (first non-null 0)', () => {
    // [0, 100] draws a sparkline but the % is undefined (÷0) → no fabricated trend label.
    const { container } = render(<SparklineCell volumes={[vol(0), vol(100)]} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelector('title')).toBeNull();
  });
});
