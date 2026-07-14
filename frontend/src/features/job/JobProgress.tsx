import type { ReactElement } from 'react';
import type { JobState } from '../../lib/jobState';

/**
 * Presentational job-progress view (T1.3, TC-14; FR-3). **Pure**: driven entirely
 * by {@link JobState} — the effectful `useJobTracking` shell owns all IO. Renders
 * the four operator-facing states (progress / partial / failed / canceled; plus
 * the success + queued/confirming progress variants). Tokens only — no hardcoded
 * hex. `partial` is styled distinctly from `completed` so a partial run is never
 * read as a complete one (C3).
 */
export function JobProgress({
  state,
  onCancel,
}: {
  state: JobState;
  onCancel?: () => void;
}): ReactElement {
  switch (state.status) {
    case 'queued':
    case 'running':
    case 'confirming':
      return <ProgressView state={state} onCancel={onCancel} />;
    case 'completed':
      return <ResultView tone="success" title="分析完成" count={state.result?.count} />;
    case 'partial':
      return (
        <ResultView
          tone="warn"
          title="部分完成"
          count={state.result?.count}
          note="部分結果已可檢視，其餘項目未能完成。"
        />
      );
    case 'failed':
      return <FailedView error={state.error} />;
    case 'canceled':
      return (
        <div role="status" className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-white/70">已取消</p>
          <p className="text-xs text-white/50">此分析已被取消。</p>
        </div>
      );
  }
}

function ProgressView({
  state,
  onCancel,
}: {
  state: JobState;
  onCancel?: () => void;
}): ReactElement {
  const percent = state.progress?.percent ?? 0;
  const phase = state.progress?.phase ?? '準備中';
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <p className="text-sm font-medium">分析進行中</p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-bg-input">
        <div
          role="progressbar"
          aria-label="分析進度"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{ width: `${percent}%` }}
          className="h-full rounded-full bg-brand transition-[width]"
        />
      </div>
      <p className="text-xs text-white/50">{phase}</p>
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="self-start rounded-lg px-3 py-1.5 text-xs font-medium text-white/70 ring-1 ring-white/10 hover:text-white hover:ring-white/20"
        >
          取消
        </button>
      ) : null}
    </div>
  );
}

function ResultView({
  tone,
  title,
  count,
  note,
}: {
  tone: 'success' | 'warn';
  title: string;
  count?: number;
  note?: string;
}): ReactElement {
  const toneClass = tone === 'success' ? 'text-brand' : 'text-warn';
  return (
    <div role="status" className="flex flex-col gap-1">
      <p className={`text-sm font-semibold ${toneClass}`}>{title}</p>
      {count != null ? <p className="text-xs text-white/60">共 {count} 筆結果</p> : null}
      {note ? <p className="text-xs text-white/50">{note}</p> : null}
    </div>
  );
}

function FailedView({ error }: { error: string | null }): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-trend-negative">分析失敗</p>
      <p role="alert" className="text-xs text-trend-negative">
        {error ?? '發生未知錯誤，請稍後再試。'}
      </p>
    </div>
  );
}
