import type { ReactElement } from 'react';
import { FeatureGate } from '../../components/FeatureGate';
import { featureStatusOf } from '../../lib/featureGate';
import { JobProgress } from '../job/JobProgress';
import { JourneyTable } from './JourneyTable';
import { useJourney } from './useJourney';
import type { EventSourceFactory } from '../job/useJobTracking';

/**
 * 購買歷程視圖 container (T4.4, FR-15; TC-25). Reads the `journey` gate status from
 * the `GET :id` features map (`featureStatusOf`) and hands the gate flow to
 * {@link useJourney} — the **same** start → job → content machine as T3.3 topics:
 * not_generated → start CTA (POST :id/journey), running → JobProgress off the
 * journey stream, ready → 購買歷程表 (via `POST /query {view:'journey'}`), failed →
 * retry. The route mounting (dashboard view-content routing) is a later task — this
 * is a standalone component (the funnel chart is T4.5). `eventSourceFactory` is
 * injected in tests; prod uses the default.
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
      <JourneyTable rows={rows} />
    </FeatureGate>
  );
}
