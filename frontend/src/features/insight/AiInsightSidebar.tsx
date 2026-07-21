import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CopyTsvButton } from '../../components/CopyTsvButton';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews';
import { generateAiInsight } from '../../api/aiInsight';
import { featureStatusOf } from '../../lib/featureGate';
import { serializeFiltersToUrl, type FilterSpec } from '../../lib/filterSpec';
import { labelForView } from '../../lib/viewRegistry';

/**
 * 右側 380px 可收合的 per-view AI 洞察側欄 (T4.3, FR-17; TC-27). Summarises the
 * current view's aggregated result via `POST :id/ai-insight { view, filters }`
 * ({@link generateAiInsight}), gated by the view's own feature via the reused
 * view-gate (`featureStatusOf` — not-ready → placeholder, never a request). A filter
 * change re-requests: the TanStack query key carries the **C4** canonical filters
 * serialization (`serializeFiltersToUrl`, the same single-point the URL + `/query`
 * use), so equal filters hit the cache and a change refetches with the hash the
 * backend already keys on. 複製 reuses the shared clipboard shell ({@link
 * CopyTsvButton}); an LLM 502 shows a clean error, never a half summary. Collapse is
 * a horizontal wipe (width transition). Tokens only — no hardcoded hex.
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

/** FR-17 gated placeholder — shown when the view's underlying analysis is not ready. */
const PLACEHOLDER = '完成此分析後，AI 會依目前頁面的表格與圖表產生對應洞察';

export function AiInsightSidebar({
  analysisId,
  view,
  filters,
  requiresFeature,
  features,
  scopeLabel,
  defaultCollapsed = false,
}: AiInsightSidebarProps): ReactElement {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const ready = featureStatusOf(features, requiresFeature) === 'ready';
  const scope = scopeLabel ?? labelForView(view);

  // Fetch only while open AND the view is ready. The key carries the C4 canonical
  // filters string → equal filters share the cache, a change refetches (backend
  // caches on `(snapshotId, view, filters-hash)`).
  const query = useQuery({
    queryKey: ['aiInsight', analysisId, view, serializeFiltersToUrl(filters)],
    queryFn: () => generateAiInsight(analysisId, view, filters),
    enabled: expanded && ready,
  });
  const result = query.data;

  return (
    <aside
      aria-label="AI 洞察側欄"
      className={`flex h-full flex-col overflow-hidden border-l border-white/10 bg-bg-card transition-[width] duration-300 ${
        expanded ? 'w-[380px]' : 'w-12'
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
        {expanded ? (
          <h2 className="text-sm font-semibold text-white/90">💡 AI 數據洞察總結 —{scope}</h2>
        ) : null}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="ai-insight-panel"
          aria-label={expanded ? '收合 AI 洞察側欄' : '展開 AI 洞察側欄'}
          className="rounded px-2 py-1 text-white/60 hover:text-white"
        >
          {expanded ? '⟩' : '⟨'}
        </button>
      </div>

      {expanded ? (
        <div id="ai-insight-panel" className="flex-1 overflow-y-auto p-4">
          {!ready ? (
            <EmptyState className="text-sm text-white/60" message={PLACEHOLDER} />
          ) : query.isLoading ? (
            <LoadingState label="洞察生成中…" />
          ) : result && result.ok ? (
            <div className="flex flex-col gap-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/80">
                {result.insight}
              </p>
              <CopyTsvButton getTsv={() => result.insight} label="複製洞察" />
            </div>
          ) : (
            <ErrorState
              message="AI 洞察生成失敗，請稍後再試"
              onRetry={() => void query.refetch()}
            />
          )}
        </div>
      ) : null}
    </aside>
  );
}
