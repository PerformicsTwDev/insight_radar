import { useState, type ReactElement } from 'react';
import { FeatureGate } from '../../components/FeatureGate';
import { SegmentedControl } from '../../components/SegmentedControl';
import { featureStatusOf } from '../../lib/featureGate';
import { JobProgress } from '../job/JobProgress';
import { TopicsTable } from './TopicsTable';
import { TopicsTreemap } from './TopicsTreemap';
import { useTopics } from './useTopics';
import type { TopicsResponse } from '../../api/topics';
import type { EventSourceFactory } from '../job/useJobTracking';

/** 表格|圖表 toggle options (T3.4); `table` is the default so T3.3 behaviour is unchanged. */
const TOPIC_VIEW_OPTIONS = [
  { value: 'table', label: '表格' },
  { value: 'chart', label: '圖表' },
] as const;

type TopicView = (typeof TOPIC_VIEW_OPTIONS)[number]['value'];

/**
 * Ready-state content (T3.4): a 表格|圖表 segmented switching between the 主題表 and
 * the treemap. Local UI state only — this mounts solely inside the FeatureGate
 * `ready` branch (its `children`), so the segmented never shows in the CTA / running
 * / failed states. Default 表格 keeps the T3.3 "ready → 主題表" behaviour intact.
 */
function TopicsReadyContent({ topics }: { topics: TopicsResponse | undefined }): ReactElement {
  const [view, setView] = useState<TopicView>('table');
  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        options={TOPIC_VIEW_OPTIONS}
        value={view}
        onChange={setView}
        ariaLabel="主題檢視方式"
      />
      {view === 'table' ? <TopicsTable topics={topics} /> : <TopicsTreemap topics={topics} />}
    </div>
  );
}

/**
 * 意圖主題視圖 container (T3.3, FR-8; TC-19). Reads the `topics` gate status from
 * the `GET :id` features map (`featureStatusOf`) and hands the gate flow to
 * {@link useTopics}: not_generated → start CTA (POST :id/topics), running →
 * JobProgress off the topics stream, ready → 主題表, failed → retry. The route
 * mounting (dashboard view-content routing) is a later task — this is a standalone
 * component. `eventSourceFactory` is injected in tests; prod uses the default.
 */
export interface IntentTopicsViewProps {
  readonly analysisId: string;
  readonly features: unknown;
  readonly eventSourceFactory?: EventSourceFactory;
}

export function IntentTopicsView({
  analysisId,
  features,
  eventSourceFactory,
}: IntentTopicsViewProps): ReactElement {
  const featureStatus = featureStatusOf(features, 'topics');
  const { status, jobState, topics, blocked, partial, start } = useTopics(
    analysisId,
    featureStatus,
    { eventSourceFactory },
  );

  return (
    <FeatureGate
      status={status}
      featureLabel="意圖主題"
      notice={blocked ? '請先完成關鍵字分析，才能進行意圖主題分析' : undefined}
      partial={partial}
      onStart={() => void start()}
      onRetry={() => void start()}
      progress={<JobProgress state={jobState} />}
    >
      <TopicsReadyContent topics={topics} />
    </FeatureGate>
  );
}
