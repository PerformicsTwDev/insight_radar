import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeatureGate } from './FeatureGate';

/**
 * TC-20 (component) — the reusable feature-gate overlay's four states (T3.2,
 * FR-9): not_generated → start CTA, running → progress, ready → content, failed →
 * retry; plus the ready-but-partial notice (GET :id authoritative, FR-9 boundary).
 */
const CONTENT = <div>gate-content</div>;

describe('TC-20 · FeatureGate (feature-gate 覆層四態)', () => {
  it('not_generated → shows the start CTA (with the feature label), not the content', () => {
    const onStart = vi.fn();
    render(
      <FeatureGate status="not_generated" featureLabel="意圖主題" onStart={onStart}>
        {CONTENT}
      </FeatureGate>,
    );
    expect(screen.queryByText('gate-content')).not.toBeInTheDocument();
    expect(screen.getByText(/意圖主題/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /開始分析/ }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('running → renders the provided progress node, not the content', () => {
    render(
      <FeatureGate status="running" progress={<span>分析中 42%</span>}>
        {CONTENT}
      </FeatureGate>,
    );
    expect(screen.queryByText('gate-content')).not.toBeInTheDocument();
    expect(screen.getByText('分析中 42%')).toBeInTheDocument();
  });

  it('running → renders a default running status when no progress node is given', () => {
    render(<FeatureGate status="running">{CONTENT}</FeatureGate>);
    expect(screen.queryByText('gate-content')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('ready → shows the gated content', () => {
    render(<FeatureGate status="ready">{CONTENT}</FeatureGate>);
    expect(screen.getByText('gate-content')).toBeInTheDocument();
  });

  it('ready + partial → shows the content AND a partial notice (GET :id authoritative)', () => {
    render(
      <FeatureGate status="ready" partial>
        {CONTENT}
      </FeatureGate>,
    );
    expect(screen.getByText('gate-content')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/部分/);
  });

  it('failed → shows a retry button, not the content', () => {
    const onRetry = vi.fn();
    render(
      <FeatureGate status="failed" onRetry={onRetry}>
        {CONTENT}
      </FeatureGate>,
    );
    expect(screen.queryByText('gate-content')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /重試/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
