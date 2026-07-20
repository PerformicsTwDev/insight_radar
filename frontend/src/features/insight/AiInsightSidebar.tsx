import type { ReactElement } from 'react';
import type { FilterSpec } from '../../lib/filterSpec';

/**
 * 右側可收合的 per-view AI 洞察側欄 (T4.3, FR-17; TC-27). Summarises the current
 * view's aggregated result via `POST :id/ai-insight { view, filters }`. Reuses the
 * view-gate (`featureStatusOf`) for the not-ready placeholder, the C4 canonical
 * filters serialization (so a filter change re-requests with a hash the backend
 * cache already keys on), and the shared clipboard shell (`CopyTsvButton`) for 複製.
 */
export interface AiInsightSidebarProps {
  readonly analysisId: string;
  /** Current view name (view-router whitelist, e.g. `keywords` / `journey`). */
  readonly view: string;
  /** Currently-applied filters for this view (canonical `FilterSpec`, C4). */
  readonly filters: FilterSpec;
  /** The view's required feature key (viewRegistry `requiresFeature`) — drives the gate. */
  readonly requiresFeature: string;
  /** The `GET :id` features map (opaque) — read via `featureStatusOf`. */
  readonly features: unknown;
  /** Heading scope label; defaults to the view's zh label (`labelForView`). */
  readonly scopeLabel?: string;
  /** Start collapsed (default open). */
  readonly defaultCollapsed?: boolean;
}

export function AiInsightSidebar(_props: AiInsightSidebarProps): ReactElement {
  // SHELL (red): not implemented.
  return <aside aria-label="AI 洞察側欄" />;
}
