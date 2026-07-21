import { useState, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ANALYSIS_STATUSES,
  listKeywordAnalyses,
  type AnalysisListRow,
  type AnalysisStatus,
} from '../../api/keywordAnalyses';
import { config } from '../../config/env';
import { EM_DASH, formatVolume } from '../../lib/keywordsTable';
import { totalPages } from '../../lib/pagination';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews';

/**
 * 分析歷史 view (T3.5, FR-10; TC-21 / AC-10.1). Lists past analyses
 * (`GET /keyword-analyses`, createdAt desc) with a status filter restricted to the
 * valid enum + offset pagination (FR-7 semantics), and reopens a row's analysis by
 * navigating to the dashboard with its `analysisId` (URL restore, FR-1). Empty →
 * empty state; a load failure → an error note (never a misleading empty). Tokens only.
 */
const STATUS_ZH: Readonly<Record<AnalysisStatus, string>> = {
  queued: '排隊中',
  running: '進行中',
  completed: '完成',
  partial: '部分完成',
  failed: '失敗',
  canceled: '已取消',
};

/** `all` sentinel → no status filter (send undefined). */
type StatusFilter = AnalysisStatus | 'all';

/** ISO → `YYYY-MM-DD HH:mm` (UTC, deterministic — no locale/timezone drift). */
function formatWhen(iso: string | null): string {
  return iso === null ? EM_DASH : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** Non-empty seeds joined; empty → —. */
function formatSeeds(seeds: readonly string[]): string {
  return seeds.length > 0 ? seeds.join('、') : EM_DASH;
}

/** `mode · geo · language`, omitting absent parts; all absent → —. */
function formatParams(params: AnalysisListRow['params']): string {
  const parts = [params.mode, params.geo, params.language].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' · ') : EM_DASH;
}

export function HistoryView(): ReactElement {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>('all');
  const pageSize = config.defaultPageSize;

  const query = useQuery({
    queryKey: ['analyses', page, pageSize, status],
    queryFn: () =>
      listKeywordAnalyses({ page, pageSize, status: status === 'all' ? undefined : status }),
  });

  function reopen(row: AnalysisListRow): void {
    // Fresh dashboard for the chosen analysis (URL restore, FR-1) — stale
    // filters/pagination from the history context are dropped. The row's (geo,
    // language) context rides along (Design §5) so the reopened 搜尋詞總表 can seed
    // list-layer-fixed tracking selections (FR-19), same as the create path.
    void navigate({
      to: '/',
      search: { analysisId: row.analysisId, geo: row.params.geo, language: row.params.language },
    });
  }

  function changeStatus(next: StatusFilter): void {
    setStatus(next);
    setPage(1); // a new filter resets to the first page.
  }

  return (
    <section className="flex flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">分析歷史</h2>
        <label className="flex items-center gap-1 text-xs text-white/50">
          狀態
          <select
            aria-label="狀態篩選"
            value={status}
            onChange={(e) => changeStatus(e.target.value as StatusFilter)}
            className="rounded-lg bg-bg-input px-2 py-1 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-brand"
          >
            <option value="all">全部</option>
            {ANALYSIS_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_ZH[s]}
              </option>
            ))}
          </select>
        </label>
      </header>

      <HistoryBody query={query} onReopen={reopen} />

      {query.data?.ok && query.data.data.length > 0 ? (
        <Pager
          page={page}
          pages={totalPages(query.data.meta.total, pageSize)}
          total={query.data.meta.total}
          onPage={setPage}
        />
      ) : null}
    </section>
  );
}

type HistoryQuery = ReturnType<typeof useQuery<Awaited<ReturnType<typeof listKeywordAnalyses>>>>;

function HistoryBody({
  query,
  onReopen,
}: {
  readonly query: HistoryQuery;
  readonly onReopen: (row: AnalysisListRow) => void;
}): ReactElement {
  const result = query.data;
  if (!result) {
    return <LoadingState className="p-8 text-center text-sm text-white/50" />;
  }
  if (!result.ok) {
    return (
      <ErrorState
        message="無法載入分析歷史，請稍後再試。"
        onRetry={() => void query.refetch()}
        className="p-8 text-center text-sm text-trend-negative"
      />
    );
  }
  if (result.data.length === 0) {
    return (
      <EmptyState
        message="尚無分析紀錄"
        className="rounded-lg border border-white/10 bg-bg-card p-8 text-center text-sm text-white/50"
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl bg-bg-card ring-1 ring-white/10">
      <table aria-label="分析歷史清單" className="w-full border-collapse text-sm text-white/80">
        <thead className="bg-bg-raised text-xs text-white/60">
          <tr>
            {['關鍵字', '狀態', '參數', '建立時間', '完成時間', '筆數', ''].map((h, i) => (
              <th key={i} scope="col" className="px-3 py-2 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.data.map((row) => (
            <tr key={row.analysisId} className="border-t border-white/5">
              <td className="max-w-xs truncate px-3 py-2 text-white">{formatSeeds(row.seeds)}</td>
              <td className="px-3 py-2">{STATUS_ZH[row.status]}</td>
              <td className="px-3 py-2 text-white/60">{formatParams(row.params)}</td>
              <td className="px-3 py-2 font-mono text-xs tabular-nums text-white/60">
                {formatWhen(row.createdAt)}
              </td>
              <td className="px-3 py-2 font-mono text-xs tabular-nums text-white/60">
                {formatWhen(row.finishedAt)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {formatVolume(row.count)}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onReopen(row)}
                  className="rounded-lg bg-brand px-3 py-1 text-xs font-medium text-black"
                >
                  開啟
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pager({
  page,
  pages,
  total,
  onPage,
}: {
  readonly page: number;
  readonly pages: number;
  readonly total: number;
  readonly onPage: (page: number) => void;
}): ReactElement {
  const navBtn =
    'rounded-lg px-2.5 py-1 text-xs text-white/70 ring-1 ring-white/10 enabled:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div
      role="group"
      aria-label="分頁"
      className="flex items-center justify-end gap-2 text-sm text-white/70"
    >
      <span className="tabular-nums text-white/50">共 {total} 筆</span>
      <button
        type="button"
        aria-label="上一頁"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className={navBtn}
      >
        上一頁
      </button>
      <span className="tabular-nums">
        {page} / {pages}
      </span>
      <button
        type="button"
        aria-label="下一頁"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        className={navBtn}
      >
        下一頁
      </button>
    </div>
  );
}
