import type { ReactElement, ReactNode } from 'react';
import type { FeatureStatus } from '../lib/featureGate';

/**
 * Reusable feature-gate overlay (T3.2, FR-9). Presentational only — driven by a
 * resolved {@link FeatureStatus}; the container reads it from `GET :id` features
 * (via `featureStatusOf`) and owns the start/retry effects. Renders the four
 * states: `not_generated` → start CTA, `running` → progress, `ready` → content
 * (`children`), `failed` → retry. When `ready` but the underlying data is
 * `partial` (status/data conflict — `GET :id` is authoritative, FR-9 boundary) the
 * content is shown with a partial notice. Tokens only — no hardcoded hex.
 */
export interface FeatureGateProps {
  readonly status: FeatureStatus;
  /** The gated content, shown only when `status === 'ready'`. */
  readonly children: ReactNode;
  /** Feature name for the CTA copy (e.g. 「意圖主題」); optional. */
  readonly featureLabel?: string;
  /** Invoked by the `not_generated` CTA. */
  readonly onStart?: () => void;
  /** Invoked by the `failed` retry button. */
  readonly onRetry?: () => void;
  /** Progress node for the `running` state (e.g. `<JobProgress>`); a default is shown if omitted. */
  readonly progress?: ReactNode;
  /** `ready` but the data is partial → show a partial notice alongside the content (FR-9). */
  readonly partial?: boolean;
}

export function FeatureGate({
  status,
  children,
  featureLabel = '',
  onStart,
  onRetry,
  progress,
  partial = false,
}: FeatureGateProps): ReactElement {
  switch (status) {
    case 'not_generated':
      return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-white/10 bg-bg-card p-8 text-center">
          <p className="text-sm text-white/60">尚未進行{featureLabel}分析</p>
          <button
            type="button"
            onClick={onStart}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-black"
          >
            ✦ 開始分析
          </button>
        </div>
      );
    case 'running':
      return (
        <div role="status" className="rounded-lg border border-white/10 bg-bg-card p-8">
          {progress ?? <p className="text-sm text-white/60">分析進行中…</p>}
        </div>
      );
    case 'failed':
      return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-trend-negative/40 bg-bg-card p-8 text-center">
          <p className="text-sm font-semibold text-trend-negative">分析失敗</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white"
          >
            重試
          </button>
        </div>
      );
    case 'ready':
      return (
        <>
          {partial ? (
            <p role="status" className="mb-2 rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">
              部分結果已可檢視，其餘項目未能完成。
            </p>
          ) : null}
          {children}
        </>
      );
  }
}
