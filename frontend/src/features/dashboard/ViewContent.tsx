import { useMemo, type ReactElement } from 'react';
import { labelForView } from '../../lib/viewRegistry';
import { resolveView } from '../../lib/viewResolve';
import { CustomClassifyView } from '../custom/CustomClassifyView';
import { JourneyView } from '../journey/JourneyView';
import { KeywordsView } from '../keywords/KeywordsView';
import { IntentTopicsView } from '../topics/IntentTopicsView';
import { TrendView } from '../trend/TrendView';
import { useViews } from '../views/useViews';
import { UnavailableView, ViewNotFound } from './ViewStates';

/**
 * View-content router (T6.0, FR-1 / AC-1.2). The single point that turns the URL
 * `view` param into dashboard content, resolved against the **live registry**
 * (`useViews` → `GET /views`) via the pure {@link resolveView} — never a hardcoded
 * view-name list, so a newly-registered backend view routes with zero change here
 * (AC-1.2). Known views map to their standalone M2–M5 components; a `custom:{cid}`
 * maps to the dynamic classification view; an unknown-but-valid string lands on a
 * non-blank not-found (FR-1). `features` (from the `GET :id` snapshot) gates the
 * topics / journey views.
 */

export interface ViewContentProps {
  readonly analysisId: string;
  readonly view: string | undefined;
  readonly features: unknown;
}

export function ViewContent({ analysisId, view, features }: ViewContentProps): ReactElement {
  const { registry } = useViews();
  const known = useMemo(() => new Set(registry.navItems.map((item) => item.name)), [registry]);
  const resolution = resolveView(view, known);

  switch (resolution.kind) {
    case 'not_found':
      return <ViewNotFound view={resolution.view} />;
    case 'custom':
      // The dynamic tab view owns its own cid tabs; a `custom:{cid}` URL lands here.
      return <CustomClassifyView analysisId={analysisId} />;
    case 'default':
      return <KeywordsView analysisId={analysisId} />;
    case 'known':
      return <KnownView view={resolution.view} analysisId={analysisId} features={features} />;
  }
}

/**
 * Map a known registry view name to its dashboard component. A known view without a
 * bespoke component yet (chart-shape / serp-gated placeholders) renders the explicit
 * {@link UnavailableView} — distinct from the FR-1 unknown-view not-found.
 */
function KnownView({
  view,
  analysisId,
  features,
}: {
  readonly view: string;
  readonly analysisId: string;
  readonly features: unknown;
}): ReactElement {
  switch (view) {
    case 'keywords':
      return <KeywordsView analysisId={analysisId} />;
    case 'trend':
      return <TrendView analysisId={analysisId} />;
    case 'intent_topics':
      return <IntentTopicsView analysisId={analysisId} features={features} />;
    case 'journey':
    case 'journey_funnel':
      // Both share the `journey` feature + the one JourneyView (its own 表格|漏斗圖
      // toggle); the distinct `journey_funnel` registry view opens on the 漏斗圖 so a
      // nav-select / reopen restores the funnel (AC-1.1) and T6.3 screenshots it.
      return (
        <JourneyView
          analysisId={analysisId}
          features={features}
          initialMode={view === 'journey_funnel' ? 'chart' : 'table'}
        />
      );
    default:
      return <UnavailableView view={view} label={labelForView(view)} />;
  }
}
