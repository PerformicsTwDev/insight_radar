/**
 * Pure custom-view tab helpers (T5.2, FR-16). All the dynamic-tab branching lives here
 * (no React / no IO → core `src/lib/**`, ≥90 gate) so the container stays a thin shell:
 * the `custom:{cid}` view-router name + the assignments SSE sub-path, and the tab-list
 * reducers (upsert dedupe / remove / next-active selection after a delete). Integrates
 * with the T3.1 view registry by convention — a `custom:{cid}` view carries its own
 * label (the classification name), so it is not enumerated in `VIEW_LABELS`.
 */

/** A registered dynamic classification tab: its id (`cid`) + display name. */
export interface CustomTab {
  readonly cid: string;
  readonly name: string;
}

/** The view-router `view` name for a custom classification (`POST /query {view}`). */
export function customViewName(cid: string): string {
  return `custom:${cid}`;
}

/** The analysis-scoped assignments SSE sub-path for `useJobTracking` (`buildStreamUrl`). */
export function customAssignStreamPath(cid: string): string {
  return `custom-classifications/${cid}/assignments/stream`;
}

/** Append a tab, de-duplicated by `cid` (a re-run of the same classification adds no duplicate). */
export function upsertTab(tabs: readonly CustomTab[], tab: CustomTab): readonly CustomTab[] {
  return tabs.some((existing) => existing.cid === tab.cid) ? tabs : [...tabs, tab];
}

/** Remove the tab with `cid` (a no-op for an unknown cid). */
export function removeTab(tabs: readonly CustomTab[], cid: string): readonly CustomTab[] {
  return tabs.filter((tab) => tab.cid !== cid);
}

/**
 * Select the next active cid after a delete: keep the current active if a *different*
 * tab was removed; if the active tab itself was removed, activate the first remaining
 * tab, or null when none remain. `remaining` is the tab list **after** the removal.
 */
export function nextActiveCid(
  remaining: readonly CustomTab[],
  removedCid: string,
  currentActive: string | null,
): string | null {
  if (currentActive !== removedCid) return currentActive;
  return remaining[0]?.cid ?? null;
}
