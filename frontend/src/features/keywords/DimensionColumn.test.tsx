import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DIMENSION_ACCENT_COLOR, DimensionCell, DimensionHeader } from './DimensionColumn';
import { EM_DASH } from '../../lib/keywordsTable';

/**
 * TC-28 (FR-18) — the reusable on-demand dimension column (搜尋意圖主題 / 購買歷程主題).
 * Presentational: cell states (masked / generating / value pill / unclassified —) and the
 * header phases (ready / generatable ✦ trigger / generating). The generate trigger fires the
 * container's handler but the C13 gate-decoupling (no view unlock) is enforced by the container.
 */

describe('TC-28 · DIMENSION_ACCENT_COLOR (SSOT; mirrors @theme brand / informational, M7-R2b)', () => {
  it('maps topic → brand green and journey → informational blue', () => {
    expect(DIMENSION_ACCENT_COLOR).toEqual({
      topic: '#52b788', // --color-brand
      journey: '#5bc0eb', // --color-intent-informational
    });
  });
});

describe('TC-28 · DimensionCell (masked / generating / value pill / — states, M7-R2b)', () => {
  it('renders a coloured pill for a generated value, tinted by the accent', () => {
    render(<DimensionCell state={{ kind: 'value', label: '規格探究' }} accent="topic" />);
    const pill = screen.getByText('規格探究');
    expect(pill).toHaveStyle({ color: DIMENSION_ACCENT_COLOR.topic });
  });

  it('uses the journey accent (blue) for a journey pill', () => {
    render(<DimensionCell state={{ kind: 'value', label: '最終決策' }} accent="journey" />);
    expect(screen.getByText('最終決策')).toHaveStyle({ color: DIMENSION_ACCENT_COLOR.journey });
  });

  it('shows — (never a fabricated value) for a generated-but-unclassified keyword', () => {
    render(<DimensionCell state={{ kind: 'empty' }} accent="topic" />);
    expect(screen.getByText(EM_DASH)).toBeInTheDocument();
  });

  it('shows an accessible masked placeholder before generation (no leaked value)', () => {
    render(<DimensionCell state={{ kind: 'masked' }} accent="topic" />);
    expect(screen.getByRole('img', { name: '尚未生成' })).toBeInTheDocument();
  });

  it('marks the masked cell as generating (pulsing) while the dimension job runs', () => {
    render(<DimensionCell state={{ kind: 'generating' }} accent="journey" />);
    const mask = screen.getByRole('img', { name: '生成中' });
    expect(mask.className).toContain('animate-pulse');
  });
});

describe('TC-28 · DimensionHeader (ready / generatable ✦ / generating, M7-R2b)', () => {
  const noop = (): void => {};

  it('renders a plain label once the dimension is generated (ready)', () => {
    render(<DimensionHeader label="搜尋意圖主題" phase="ready" onGenerate={noop} />);
    expect(screen.getByText('搜尋意圖主題')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a ✦ generate-all trigger that fires onGenerate when generatable', () => {
    const onGenerate = vi.fn();
    render(<DimensionHeader label="搜尋意圖主題" phase="generatable" onGenerate={onGenerate} />);
    const trigger = screen.getByRole('button', { name: /搜尋意圖主題/ });
    fireEvent.click(trigger);
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('shows a running marker (no re-trigger) while generating', () => {
    const onGenerate = vi.fn();
    render(<DimensionHeader label="購買歷程主題" phase="generating" onGenerate={onGenerate} />);
    expect(screen.getByRole('status', { name: '生成中' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
