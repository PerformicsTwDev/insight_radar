import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useInFlightGuard } from '../../hooks/useInFlightGuard';
import {
  getTrackingListSeries,
  refreshTrackingList,
  removeTrackingMember,
  type TrackingSeriesMember,
  type VolumeSeriesResponse,
} from '../../api/trackingLists';
import { rangeToFrom, type SeriesRange, type VolumeMemberInput } from '../../lib/volumeSeries';
import { trackingListErrorMessage } from '../../lib/trackingListError';
import { formatVolume } from '../../lib/keywordsTable';
import { SegmentedControl } from '../../components/SegmentedControl';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SparklineCell } from '../keywords/SparklineCell';
import { TrackingSeriesChart } from './TrackingSeriesChart';

/**
 * Tracking-list detail time-series dashboard (T5.6, FR-19; backend FR-30 · AC-30.1~30.5 ·
 * Design §9.2). Reads the list's volume series over the **observation** axis `fetchedAt`
 * (metric-revision snapshots, NOT months) and renders: a line chart (aggregate `total` +
 * selected member lines, C11), a 6M/12M/all time window, an optional manual refresh, and a
 * member table (latest search volume · sparkline · addedAt · confirm-gated remove). Empty /
 * first-run series draws "尚無時序資料" — never a fabricated 0 line (AC-30.3). Standalone
 * (nav routing is #443); tokens only.
 */

const CARD = 'rounded-xl bg-bg-card p-4 ring-1 ring-white/10';
const SEC_BTN =
  'rounded-lg px-3 py-1.5 text-sm text-white/70 ring-1 ring-white/10 hover:bg-white/5';
const GHOST_BTN = 'rounded-lg px-2 py-1 text-xs text-white/50 hover:bg-white/5 hover:text-white';

const RANGE_OPTIONS: readonly { value: SeriesRange; label: string }[] = [
  { value: '6m', label: '6 個月' },
  { value: '12m', label: '12 個月' },
  { value: 'all', label: '全部' },
];

export interface TrackingDetailViewProps {
  readonly listId: string;
}

export function TrackingDetailView({ listId }: TrackingDetailViewProps): ReactElement {
  const [series, setSeries] = useState<VolumeSeriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [range, setRange] = useState<SeriesRange>('12m');
  const [error, setError] = useState<string | null>(null);
  const [refreshHint, setRefreshHint] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<TrackingSeriesMember | null>(null);

  // The two async triggers stay clickable until their request resolves → guard re-entry
  // (M4-R1) so a fast double-click fires exactly ONE DELETE / refresh POST.
  const guardRemove = useInFlightGuard();
  const guardRefresh = useInFlightGuard();

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadFailed(false);
    // `from` bounds only the chart window; `to` omitted = up to now (member `latest` is
    // the member's actual latest regardless, #471-1). `all` → no lower bound.
    const res = await getTrackingListSeries(listId, { from: rangeToFrom(range, new Date()) });
    setLoading(false);
    if (res.ok) setSeries(res.series);
    else setLoadFailed(true);
  }, [listId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  // Members → chart line inputs (key = normalizedText selection identity; series over the
  // fetchedAt axis). The table renders the full member list separately.
  const chartMembers = useMemo<VolumeMemberInput[]>(
    () =>
      (series?.members ?? []).map((member) => ({
        key: member.normalizedText,
        label: member.text,
        series: member.series,
      })),
    [series],
  );

  const handleRefresh = (): Promise<void> =>
    guardRefresh(async () => {
      setError(null);
      const res = await refreshTrackingList(listId);
      if (res.ok) setRefreshHint('已排入刷新，指標更新後重新整理即可查看');
      else setError(trackingListErrorMessage(res.status, undefined));
    });

  const handleRemoveMember = (member: TrackingSeriesMember): Promise<void> =>
    guardRemove(async () => {
      setError(null);
      const res = await removeTrackingMember(listId, member.normalizedText);
      setRemovingMember(null);
      if (res.ok) {
        setSeries((prev) =>
          prev
            ? {
                ...prev,
                members: prev.members.filter((m) => m.normalizedText !== member.normalizedText),
              }
            : prev,
        );
      } else {
        setError(trackingListErrorMessage(res.status, undefined));
      }
    });

  return (
    <section aria-label="追蹤清單時序" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-white">{series?.list.name ?? '追蹤清單時序'}</h1>
        <div className="flex items-center gap-3">
          <SegmentedControl
            options={RANGE_OPTIONS}
            value={range}
            onChange={setRange}
            ariaLabel="時間範圍"
          />
          <button type="button" onClick={() => void handleRefresh()} className={SEC_BTN}>
            重新整理搜量
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-trend-negative">
          {error}
        </p>
      ) : null}
      {refreshHint ? (
        <p role="status" className="text-sm text-white/60">
          {refreshHint}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-white/40">載入中…</p> : null}
      {loadFailed ? <p className="text-sm text-trend-negative">時序載入失敗</p> : null}

      {series ? (
        <>
          <TrackingSeriesChart axis={series.axis} total={series.total} members={chartMembers} />
          <MemberTable members={series.members} onRemove={setRemovingMember} />
        </>
      ) : null}

      {removingMember ? (
        <ConfirmDialog
          title="移除成員"
          body={`確定要把「${removingMember.text}」移出這個追蹤清單嗎？`}
          confirmLabel="確定移除"
          onCancel={() => setRemovingMember(null)}
          onConfirm={() => void handleRemoveMember(removingMember)}
        />
      ) : null}
    </section>
  );
}

/** ISO → `YYYY-MM-DD` (UTC) for the addedAt column (mirrors the observation-label convention). */
function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}

/** Member table: latest search volume · sparkline (reused) · addedAt · confirm-gated remove. */
function MemberTable({
  members,
  onRemove,
}: {
  members: readonly TrackingSeriesMember[];
  onRemove: (member: TrackingSeriesMember) => void;
}): ReactElement {
  return (
    <div className={CARD}>
      <h2 className="mb-3 text-sm font-semibold text-white/80">追蹤成員</h2>
      {members.length === 0 ? (
        <p className="text-sm text-white/40">此清單尚無成員。</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-white/40">
              <th scope="col" className="py-1 font-medium">
                成員
              </th>
              <th scope="col" className="py-1 font-medium">
                最新月搜量
              </th>
              <th scope="col" className="py-1 font-medium">
                走勢
              </th>
              <th scope="col" className="py-1 font-medium">
                加入時間
              </th>
              <th scope="col" className="py-1 font-medium">
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {members.map((member) => (
              <tr key={member.normalizedText}>
                <td className="py-2 text-white/80">{member.text}</td>
                <td className="py-2 text-white/70">
                  {formatVolume(member.latest?.avgMonthlySearches ?? null)}
                </td>
                <td className="py-2">
                  <SparklineCell
                    volumes={member.series.map((point) => ({
                      searches: point.avgMonthlySearches,
                    }))}
                  />
                </td>
                <td className="py-2 text-white/50">{formatDate(member.addedAt)}</td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    aria-label={`移除 ${member.text}`}
                    onClick={() => onRemove(member)}
                    className={GHOST_BTN}
                  >
                    移除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
