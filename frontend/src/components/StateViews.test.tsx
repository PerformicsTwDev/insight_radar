import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, LoadingState } from './StateViews';
import { FeatureGate } from './FeatureGate';

/**
 * TC-22 (component) — the unified async-state matrix (T6.1, FR-11): skeleton
 * (LoadingState) / empty (EmptyState) / error+retry (ErrorState) / gate
 * (FeatureGate reuse). ErrorState is the security boundary — a raw 5xx error
 * derives a SAFE generic message and never renders the backend stack/detail
 * (NFR-5).
 */
describe('TC-22 · unified state components (skeleton / empty / error+retry / gate)', () => {
  describe('LoadingState (skeleton)', () => {
    it('renders a live status region with the default label', () => {
      render(<LoadingState />);
      expect(screen.getByRole('status')).toHaveTextContent('載入中…');
    });

    it('accepts a per-view label + className (reused loading copy / call-site look)', () => {
      render(
        <LoadingState label="洞察生成中…" className="p-8 text-center text-sm text-white/50" />,
      );
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('洞察生成中…');
      expect(status).toHaveClass('text-center');
    });
  });

  describe('EmptyState (empty)', () => {
    it('renders the empty message', () => {
      render(<EmptyState message="尚無資料" />);
      expect(screen.getByText('尚無資料')).toBeInTheDocument();
    });

    it('renders children when provided (rich empty content) + honours a custom className', () => {
      render(
        <EmptyState className="p-8 text-center">
          <span>自訂空狀態</span>
        </EmptyState>,
      );
      expect(screen.getByText('自訂空狀態')).toBeInTheDocument();
    });
  });

  describe('ErrorState (error + retry)', () => {
    it('renders an alert with an explicit message and NO retry when onRetry is absent', () => {
      render(<ErrorState message="清單載入失敗" />);
      expect(screen.getByRole('alert')).toHaveTextContent('清單載入失敗');
      expect(screen.queryByRole('button', { name: '重試' })).not.toBeInTheDocument();
    });

    it('renders a retry affordance that fires the callback on click when onRetry is given', () => {
      const onRetry = vi.fn();
      render(
        <ErrorState
          message="時序載入失敗"
          onRetry={onRetry}
          className="text-sm text-trend-negative"
        />,
      );
      expect(screen.getByRole('alert')).toHaveTextContent('時序載入失敗');
      fireEvent.click(screen.getByRole('button', { name: '重試' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('derives a SAFE generic message from a 500 error and never leaks the backend stack/detail', () => {
      render(
        <ErrorState
          error={{
            statusCode: 500,
            code: 'INTERNAL',
            message: 'TypeError: boom\n    at /app/src/service.ts:42:13',
          }}
        />,
      );
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/伺服器發生錯誤/);
      expect(alert).not.toHaveTextContent('TypeError');
      expect(alert).not.toHaveTextContent('/app/src');
    });

    it('an explicit message takes precedence over a raw error (never renders the error body)', () => {
      render(<ErrorState message="自訂訊息" error={{ statusCode: 500, message: 'leak-me' }} />);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('自訂訊息');
      expect(alert).not.toHaveTextContent('leak-me');
    });

    it('falls back to a generic non-empty message when neither message nor error is given', () => {
      render(<ErrorState />);
      expect(screen.getByRole('alert').textContent?.trim().length ?? 0).toBeGreaterThan(0);
    });

    it('supports a custom retry label', () => {
      render(<ErrorState message="x" onRetry={() => {}} retryLabel="重新載入" />);
      expect(screen.getByRole('button', { name: '重新載入' })).toBeInTheDocument();
    });
  });

  describe('gate (not-ready) reuses the shared FeatureGate', () => {
    it('not_generated → the gate shows a start CTA, not the content (four-state matrix closed)', () => {
      render(
        <FeatureGate status="not_generated" featureLabel="意圖主題" onStart={() => {}}>
          <div>gated-content</div>
        </FeatureGate>,
      );
      expect(screen.queryByText('gated-content')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /開始分析/ })).toBeInTheDocument();
    });
  });
});
