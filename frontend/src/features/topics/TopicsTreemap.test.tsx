import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopicsTreemap } from './TopicsTreemap';
import { TM_SHADES } from './treemapPalette';
import type { TopicCluster, TopicsResponse } from '../../api/topics';

/**
 * TC-19 (圖表) — 意圖主題 treemap (T3.4, FR-8). Cell area ∝ clusterVolume, coloured
 * by the 8-shade green ramp, each cell showing 主題 + pct·vol. C12: a null- or
 * zero-volume cluster is NEVER sized into a rect — only acknowledged, never
 * fabricated into area. No positive-volume cluster → an accessible empty note.
 */

function cluster(topicName: string, clusterVolume: number | null): TopicCluster {
  return {
    topicName,
    parentTopic: '',
    intentLabel: 'commercial',
    topicType: 'head',
    reason: null,
    clusterVolume,
    keywordCount: 1,
    confidence: null,
    representativeKeywords: null,
  };
}

function topicsOf(clusters: TopicCluster[]): TopicsResponse {
  return {
    status: 'completed',
    progress: null,
    clusters,
    keywords: [],
    meta: { runId: 'r', snapshotId: 's', clusterCount: clusters.length, noiseCount: 0 },
  };
}

describe('TC-19 (圖表) · TopicsTreemap', () => {
  it('renders one cell per positive-volume cluster with label + pct·vol', () => {
    render(
      <TopicsTreemap topics={topicsOf([cluster('線上課程', 750), cluster('程式設計', 250)])} />,
    );
    expect(screen.getAllByTestId('tm-cell')).toHaveLength(2);
    expect(screen.getByText('線上課程')).toBeInTheDocument();
    // pct = value / summed volume; volume is grouped via formatVolume.
    expect(screen.getByText('75.0% · 750')).toBeInTheDocument();
    expect(screen.getByText('25.0% · 250')).toBeInTheDocument();
  });

  it('does NOT size a null- or zero-volume cluster into a rect (C12)', () => {
    render(
      <TopicsTreemap
        topics={topicsOf([cluster('有量', 1000), cluster('無量', null), cluster('零量', 0)])}
      />,
    );
    expect(screen.getAllByTestId('tm-cell')).toHaveLength(1);
    expect(screen.queryByText('無量')).not.toBeInTheDocument();
    expect(screen.queryByText('零量')).not.toBeInTheDocument();
    // excluded clusters are acknowledged, never fabricated into area
    expect(screen.getByText(/2 個主題無搜尋量/)).toBeInTheDocument();
  });

  it('assigns the 8-shade ramp by volume rank, cycling past the 8th cluster', () => {
    const clusters = Array.from({ length: 9 }, (_, i) => cluster(`主題${i}`, 9000 - i * 100));
    render(<TopicsTreemap topics={topicsOf(clusters)} />);
    const cells = screen.getAllByTestId('tm-cell');
    expect(cells).toHaveLength(9);
    // cells render in volume-rank order → shade i, cycling back to shade 0 at the 9th.
    cells.forEach((cell, i) => {
      expect(cell).toHaveStyle({ backgroundColor: TM_SHADES[i % TM_SHADES.length] });
    });
    expect(cells[8]).toHaveStyle({ backgroundColor: TM_SHADES[0] });
    // all-positive → no excluded note
    expect(screen.queryByText(/無搜尋量/)).not.toBeInTheDocument();
  });

  it('shows an accessible empty note when no cluster has a positive volume', () => {
    render(<TopicsTreemap topics={topicsOf([cluster('無量', null)])} />);
    expect(screen.queryByTestId('tm-cell')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/尚無.*搜尋量/);
  });

  it('shows the empty note when topics is undefined', () => {
    render(<TopicsTreemap topics={undefined} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('tm-cell')).not.toBeInTheDocument();
  });
});
