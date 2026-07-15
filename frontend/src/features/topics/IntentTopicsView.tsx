import type { ReactElement } from 'react';
import { FeatureGate } from '../../components/FeatureGate';
import { featureStatusOf } from '../../lib/featureGate';
import { JobProgress } from '../job/JobProgress';
import { TopicsTable } from './TopicsTable';
import { useTopics } from './useTopics';
import type { EventSourceFactory } from '../job/useJobTracking';

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
  const { status, jobState, topics, start } = useTopics(analysisId, featureStatus, {
    eventSourceFactory,
  });

  return (
    <FeatureGate
      status={status}
      featureLabel="意圖主題"
      onStart={() => void start()}
      onRetry={() => void start()}
      progress={<JobProgress state={jobState} />}
    >
      <TopicsTable topics={topics} />
    </FeatureGate>
  );
}
