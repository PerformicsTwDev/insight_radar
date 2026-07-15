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

export function FeatureGate({ children }: FeatureGateProps): ReactElement {
  // red stub — always renders the content, ignoring the gate state.
  return <div>{children}</div>;
}
