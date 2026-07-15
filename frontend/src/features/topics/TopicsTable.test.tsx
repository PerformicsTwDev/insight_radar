import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TopicsTable } from './TopicsTable';
import type { TopicsResponse } from '../../api/topics';

/**
 * TC-19 (表格) — the 主題表 (T3.3, FR-8). One row per cluster showing 主題 / 意圖
 * (resolveIntent zh, C2) / 搜尋量加總 (formatVolume, null → — C12) / 關鍵字數, with a
 * 相關搜尋詞 collapse/expand that reveals that cluster's keywords. Per-cluster
 * sparkline / 競爭度 / CPC / ✦ columns are OMITTED — they are not in the backend
 * `TopicsResponse` (no per-cluster metrics); fabricating them would violate C12.
 */

const TOPICS: TopicsResponse = {
  status: 'completed',
  progress: null,
  clusters: [
    {
      topicName: '線上課程比較',
      parentTopic: '線上學習',
      intentLabel: 'commercial',
      topicType: 'head',
      reason: null,
      clusterVolume: 42000,
      keywordCount: 2,
      confidence: 0.8,
      representativeKeywords: null,
    },
    {
      topicName: '免費資源',
      parentTopic: '線上學習',
      intentLabel: '', // empty intent → — (C12)
      topicType: 'tail',
      reason: null,
      clusterVolume: null, // missing volume → — (C12)
      keywordCount: 0,
      confidence: null,
      representativeKeywords: null,
    },
    {
      topicName: '綜合主題',
      parentTopic: '線上學習',
      intentLabel: 'mixed', // unknown label → raw text, no token color
      topicType: 'tail',
      reason: null,
      clusterVolume: 100,
      keywordCount: 1,
      confidence: 0.5,
      representativeKeywords: null,
    },
  ],
  keywords: [
    {
      text: '線上課程推薦',
      normalizedText: '線上課程推薦',
      topicName: '線上課程比較',
      parentTopic: '線上學習',
      intentLabel: 'commercial',
      confidence: 0.9,
      isNoise: false,
    },
    {
      text: '課程平台評價',
      normalizedText: '課程平台評價',
      topicName: '線上課程比較',
      parentTopic: '線上學習',
      intentLabel: 'commercial',
      confidence: 0.7,
      isNoise: false,
    },
  ],
  meta: { runId: 'r', snapshotId: 's', clusterCount: 3, noiseCount: 0 },
};

describe('TC-19 · TopicsTable (主題表)', () => {
  it('renders one row per cluster with 主題 / 意圖(zh) / 搜尋量加總 / 關鍵字數', () => {
    render(<TopicsTable topics={TOPICS} />);

    expect(screen.getByText('線上課程比較')).toBeInTheDocument();
    expect(screen.getByText('免費資源')).toBeInTheDocument();
    expect(screen.getByText('綜合主題')).toBeInTheDocument();
    // resolveIntent zh mapping (C2): commercial → 商業型; unknown 'mixed' → raw label.
    expect(screen.getByText('商業型')).toBeInTheDocument();
    expect(screen.getByText('mixed')).toBeInTheDocument();
    // clusterVolume formatted with grouping.
    expect(screen.getByText('42,000')).toBeInTheDocument();
  });

  it('renders — for a null clusterVolume and an empty intent (C12, never 0)', () => {
    render(<TopicsTable topics={TOPICS} />);
    // 免費資源: null volume + empty intent → two em dashes.
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('相關搜尋詞 is collapsed by default and expands to reveal the cluster keywords', () => {
    render(<TopicsTable topics={TOPICS} />);

    expect(screen.queryByText('線上課程推薦')).not.toBeInTheDocument();

    const toggles = screen.getAllByRole('button', { name: /相關搜尋詞/ });
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('線上課程推薦')).toBeInTheDocument();
    expect(screen.getByText('課程平台評價')).toBeInTheDocument();

    fireEvent.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('線上課程推薦')).not.toBeInTheDocument();
  });

  it('expanding a cluster with no related keywords shows an empty note', () => {
    render(<TopicsTable topics={TOPICS} />);
    const toggles = screen.getAllByRole('button', { name: /相關搜尋詞/ });

    fireEvent.click(toggles[1]); // 免費資源 has no matching keywords
    expect(screen.getByText(/無相關搜尋詞/)).toBeInTheDocument();
  });

  it('renders an empty state when there are no clusters (undefined topics)', () => {
    render(<TopicsTable topics={undefined} />);
    expect(screen.getByText(/尚無主題資料/)).toBeInTheDocument();
  });
});
