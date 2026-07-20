import { useState, type ReactElement } from 'react';
import { FeatureGate } from '../../components/FeatureGate';
import { SegmentedControl } from '../../components/SegmentedControl';
import { featureStatusOf } from '../../lib/featureGate';
import { JobProgress } from '../job/JobProgress';
import { JourneyFunnel } from './JourneyFunnel';
import { JourneyTable } from './JourneyTable';
import { useJourney } from './useJourney';
import type { EventSourceFactory } from '../job/useJobTracking';

/** 表格|圖表 toggle options (T4.5); `table` is the default so T4.4 behaviour is unchanged. */
const JOURNEY_VIEW_OPTIONS = [
  { value: 'table', label: '表格' },
  { value: 'chart', label: '圖表' },
] as const;

type JourneyChartView = (typeof JOURNEY_VIEW_OPTIONS)[number]['value'];

/**
 * Ready-state content (T4.5): a 表格|圖表 segmented switching the 購買歷程表 ↔ the 漏斗圖,
 * both fed by the **same** journey `rows` (漏斗與表同資料源). Local UI state only — this
 * mounts solely inside the FeatureGate `ready` branch, so the segmented never shows in
 * the CTA / running / failed states. Default 表格 keeps the T4.4 "ready → 表" behaviour.
 */
function JourneyReadyContent({
  rows,
}: {
  rows: readonly Record<string, unknown>[] | undefined;
}): ReactElement {
  const [view, setView] = useState<JourneyChartView>('table');
  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        options={JOURNEY_VIEW_OPTIONS}
        value={view}
        onChange={setView}
        ariaLabel="購買歷程檢視方式"
      />
      {view === 'table' ? <JourneyTable rows={rows} /> : <JourneyFunnel rows={rows} />}
    </div>
  );
}

/**
 * 購買歷程視圖 container (T4.4, FR-15; TC-25). Reads the `journey` gate status from
 * the `GET :id` features map (`featureStatusOf`) and hands the gate flow to
 * {@link useJourney} — the **same** start → job → content machine as T3.3 topics:
 * not_generated → start CTA (POST :id/journey), running → JobProgress off the
 * journey stream, ready → a 表格|圖表 toggle over the 購買歷程表 / 漏斗圖 (both off
 * `POST /query {view:'journey'}` — T4.5), failed → retry. The route mounting
 * (dashboard view-content routing) is a later task — this is a standalone component.
 * `eventSourceFactory` is injected in tests; prod uses the default.
 */
export interface JourneyViewProps {
  readonly analysisId: string;
  readonly features: unknown;
  readonly eventSourceFactory?: EventSourceFactory;
}

export function JourneyView({
  analysisId,
  features,
  eventSourceFactory,
}: JourneyViewProps): ReactElement {
  const featureStatus = featureStatusOf(features, 'journey');
  const { status, jobState, rows, blocked, partial, start } = useJourney(
    analysisId,
    featureStatus,
    {
      eventSourceFactory,
    },
  );

  return (
    <FeatureGate
      status={status}
      featureLabel="購買歷程"
      notice={blocked ? '請先完成關鍵字分析，才能進行購買歷程分析' : undefined}
      partial={partial}
      onStart={() => void start()}
      onRetry={() => void start()}
      progress={<JobProgress state={jobState} />}
    >
      <JourneyReadyContent rows={rows} />
    </FeatureGate>
  );
}
