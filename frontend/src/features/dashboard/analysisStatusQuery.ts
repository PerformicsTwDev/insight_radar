/**
 * Query key for the authoritative `GET :id` status snapshot (T7.8, §7). Kept in its own
 * (non-component) module so a passive SUBSCRIBER — the top-nav {@link AnalysisContextBar} —
 * can read the SAME cached snapshot with `skipToken`, sharing the one fetch the
 * {@link AnalysisDashboard} already made, without a component file exporting a non-component
 * (react-refresh rule).
 */
export function analysisStatusQueryKey(analysisId: string): readonly [string, string] {
  return ['analysis-status', analysisId];
}
