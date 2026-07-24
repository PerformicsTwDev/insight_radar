import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState, type ReactElement, type ReactNode } from 'react';
import { deserializeFiltersFromUrl } from '../../lib/filterSpec';
import { AiInsightSidebar } from '../insight/AiInsightSidebar';
import { KeywordsFilters } from '../keywords/filters/KeywordsFilters';
import { LeftTrackingNav } from '../tracking/LeftTrackingNav';
import { useViews } from '../views/useViews';

/**
 * Results dashboard shell (M7-R17, v4 fidelity stage 1). The prototype's
 * `#view-results` puts the 分析維度 menu, the per-view filter bar, and the AI 洞察
 * side-panel in ONE shared frame around the per-view centre content — not inside each
 * view. This component is that frame: an action row (返回搜尋首頁 + filter chips +
 * 隱藏/顯示 AI 洞察 + 輸出簡報) over a fixed-height (`lg:h-[2000px]`, prototype-exact)
 * three-column grid — left 分析維度 card (192px) · centre `{children}` (the routed
 * view) · AI 洞察 side-panel (380px). Rendered by {@link AnalysisDashboard} once the
 * analysis is viewable, so every dimension view (總表 / 意圖主題 / 購買歷程 / 自訂分類)
 * shares the identical chrome and only its centre content swaps (Design §5 / FR-1).
 *
 * The fixed 2000px area intentionally overflows the viewport → the page scrolls
 * (prototype behaviour, not a viewport-tall clip); each column scrolls internally if
 * its own content is taller. Menu / filters / AI derive their state from the URL +
 * `GET /views` registry via hooks, so this frame is router-bound but prop-light.
 * Tokens only — no hardcoded hex.
 */
export function ResultsLayout({
  analysisId,
  view,
  features,
  children,
}: {
  readonly analysisId: string;
  /** Active view (URL `view`); `undefined` → the default 搜尋詞總表 (`keywords`). */
  readonly view: string | undefined;
  /** `GET :id` features map (opaque) — gates the shared AI 洞察 panel per active view. */
  readonly features: unknown;
  /** The routed per-view centre content (trend card + table + pagination, etc.). */
  readonly children: ReactNode;
}): ReactElement {
  const navigate = useNavigate();
  const { registry, degraded } = useViews();
  const filtersRaw = useSearch({ strict: false, select: (s) => s.filters });
  const filters = deserializeFiltersFromUrl(filtersRaw);
  const activeView = view ?? 'keywords';
  // The AI 洞察 panel gates on the ACTIVE view's own feature (topics/journey/…), so a
  // not-ready dimension shows its placeholder rather than firing a request (FR-17).
  const requiresFeature = registry.byName.get(activeView)?.requiresFeature ?? 'keyword_metrics';

  // 隱藏/顯示 AI 洞察 (M7-R6): default expanded (v4); the header toggle + in-panel chevron
  // share this one state. Generation itself stays click-gated inside the panel (M7-R14).
  const [aiExpanded, setAiExpanded] = useState(true);
  const toggleAi = (): void => setAiExpanded((v) => !v);

  // Selecting a dimension switches the URL `view` → the dashboard re-resolves the centre
  // content (T6.0); a fresh view starts a new page (old page/cursor belong to the prior
  // row set), filters carry over. 返回搜尋首頁 clears the analysis context entirely (T7.9).
  const selectView = (name: string): void =>
    void navigate({
      to: '/',
      search: (prev) => ({ ...prev, view: name, page: undefined, cursor: undefined }),
    });

  return (
    <div className="mx-auto w-full max-w-[98%] px-4 py-3">
      {/* Action row: 返回 + per-view filter chips (left) · AI toggle + 輸出簡報 (right). */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void navigate({ to: '/', search: {} })}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-[13px] font-semibold text-white/70 transition hover:border-white/40 hover:bg-white/5 hover:text-white"
          >
            ← 返回搜尋首頁
          </button>
          {/* Filter chips (stage 2 expands to the 9-chip v4 set); config-driven per view. */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <KeywordsFilters />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            aria-expanded={aiExpanded}
            aria-controls={aiExpanded ? 'ai-insight-panel' : undefined}
            onClick={toggleAi}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand/45 px-3 py-2 text-[13px] font-semibold text-brand transition hover:border-brand/70 hover:bg-brand/10"
          >
            {aiExpanded ? '✕ 隱藏 AI 洞察' : '💡 顯示 AI 洞察'}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-[13px] font-semibold text-white/70 transition hover:border-white/40 hover:bg-white/5 hover:text-white"
          >
            輸出簡報
          </button>
        </div>
      </div>

      {/* Fixed-height (2000px, prototype-exact) 3-col; overflows → page scrolls (M7-R17). */}
      <div className="flex flex-col items-stretch gap-4 lg:h-[2000px] lg:flex-row">
        {/* LEFT: 分析維度 card — 192px, doesn't shrink, scrolls internally if taller. */}
        <div className="flex w-full shrink-0 flex-col gap-1 self-stretch overflow-y-auto rounded-xl border border-white/10 bg-bg-card p-2 shadow-sm lg:min-h-0 lg:w-48">
          <nav aria-label="維度選單" className="flex flex-col gap-1">
            {degraded ? (
              <p
                role="status"
                className="mb-2 rounded-md bg-white/5 px-3 py-2 text-xs text-white/50"
              >
                無法載入視圖清單，改用內建預設
              </p>
            ) : null}
            {registry.navItems.map((dim) => {
              const isActive = dim.name === activeView;
              return (
                <button
                  key={dim.name}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => selectView(dim.name)}
                  className={
                    isActive
                      ? 'w-full rounded-lg border border-brand bg-bg-input px-3 py-2.5 text-left text-[13.5px] font-semibold text-brand'
                      : 'w-full rounded-lg border border-transparent px-3 py-2.5 text-left text-[13.5px] font-semibold text-white/60 transition hover:bg-white/5 hover:text-white/85'
                  }
                >
                  {dim.label}
                </button>
              );
            })}
          </nav>
          <LeftTrackingNav
            onSelect={(listId) => void navigate({ to: '/tracking/$listId', params: { listId } })}
          />
        </div>

        {/* MAIN WORKSPACE: centre view content (flex-1) + AI 洞察 side-panel (380px). */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 lg:min-h-0 lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-3 lg:min-h-0">{children}</div>
          <AiInsightSidebar
            analysisId={analysisId}
            view={activeView}
            filters={filters}
            requiresFeature={requiresFeature}
            features={features}
            expanded={aiExpanded}
            onToggle={toggleAi}
          />
        </div>
      </div>
    </div>
  );
}
