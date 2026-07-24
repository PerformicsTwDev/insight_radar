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
  /** Controlled expand state (M7-R6): the results header (KeywordsView) owns it, default open. */
  readonly expanded: boolean;
  /** Toggle handler — the header 隱藏/顯示 AI 洞察 button and the in-panel chevron both call it. */
  readonly onToggle: () => void;
}

/** FR-17 gated placeholder — shown when the view's underlying analysis is not ready. */
const PLACEHOLDER = '完成此分析後，AI 會依目前頁面的表格與圖表產生對應洞察';
/** Prompt shown (ready, not yet requested) before the user opts into an LLM generation (M7-R14). */
const GENERATE_HINT = 'AI 會依目前頁面的表格與圖表產生數據洞察總結';

export function AiInsightSidebar({
  analysisId,
  view,
  filters,
  requiresFeature,
  features,
  scopeLabel,
  expanded,
  onToggle,
}: AiInsightSidebarProps): ReactElement {
  const ready = featureStatusOf(features, requiresFeature) === 'ready';
  const scope = scopeLabel ?? labelForView(view);
  // M7-R14/R19: the LLM generation is user-initiated — the default-expanded panel (M7-R6/v4) must
  // NOT auto-fire generateAiInsight (unprompted cost/latency). The opt-in is PER-VIEW: we remember
  // WHICH view was requested (not a boolean), so switching dimension on the same persistent instance
  // (ResultsLayout keeps one AiInsightSidebar across view changes) re-shows the ✦生成 CTA rather than
  // auto-firing for the new view (M7-R19 regression fix). Post opt-in, a filter change on the SAME
  // view still refetches (they opted into it); a view change resets to the CTA.
  const [requestedView, setRequestedView] = useState<string | null>(null);
  const requested = requestedView === view;

  // Fetch only while open, ready, AND explicitly requested. The key carries the C4 canonical filters
  // string → equal filters share the cache, a change refetches (backend caches on
  // `(snapshotId, view, filters-hash)`).
  const query = useQuery({
    queryKey: ['aiInsight', analysisId, view, serializeFiltersToUrl(filters)],
    queryFn: () => generateAiInsight(analysisId, view, filters),
    enabled: expanded && ready && requested,
  });
  const result = query.data;

  return (
    // v4 (M7-R17): a rounded card that fills the right column; 隱藏 wipes it to zero width so the
    // centre expands (the action-row 隱藏/顯示 toggle + the header chevron both drive `expanded`).
    <aside
      aria-label="AI 洞察側欄"
      className={`flex h-full shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-bg-card shadow-sm transition-[width] duration-300 ${
        expanded ? 'w-full lg:w-[380px]' : 'w-0'
      }`}
    >
      {expanded ? (
        <>
          {/* Sticky header: 💡 title (15px bold) + collapse chevron; — scope below (brand). */}
          <div className="flex shrink-0 flex-col gap-1.5 border-b border-white/10 px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-bold text-white">
                <span className="text-base">💡</span>
                <span className="truncate">AI 數據洞察總結</span>
              </h2>
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-controls="ai-insight-panel"
                aria-label="收合 AI 洞察側欄"
                className="shrink-0 rounded px-2 py-1 text-white/60 hover:text-white"
              >
                ⟩
              </button>
            </div>
            <div className="text-xs font-semibold text-brand">— {scope}</div>
          </div>

          <div id="ai-insight-panel" className="flex-1 overflow-y-auto px-5 py-5 text-[13px]">
            {!ready ? (
              <EmptyState className="text-white/60" message={PLACEHOLDER} />
            ) : !requested ? (
              // Ready but not yet requested — the 生成 CTA (M7-R14): generation is user-initiated, so
              // no LLM call fires until the user asks (the panel stays open per v4).
              <div className="flex flex-col items-start gap-3">
                <p className="text-white/60">{GENERATE_HINT}</p>
                <button
                  type="button"
                  onClick={() => setRequestedView(view)}
                  className="rounded-lg bg-brand/15 px-3 py-1.5 text-brand ring-1 ring-brand/30 hover:bg-brand/25"
                >
                  ✦ 生成 AI 洞察
                </button>
              </div>
            ) : query.isLoading ? (
              <LoadingState label="洞察生成中…" />
            ) : result && result.ok ? (
              <div className="flex flex-col gap-4">
                <p className="whitespace-pre-wrap leading-relaxed text-white/80">
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
        </>
      ) : null}
    </aside>
  );
}
