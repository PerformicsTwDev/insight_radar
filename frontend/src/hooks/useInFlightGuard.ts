import { useCallback, useRef } from 'react';

/**
 * Re-entrancy guard for an async submit handler (M4-R1, #603). Returns a **stable**
 * runner that executes `task` only when no prior invocation is still outstanding; a
 * call made while a task is in flight is a silent no-op (resolves without running
 * `task`).
 *
 * This closes the duplicate-submit race a fast double-click opens whenever a trigger
 * flips out of its clickable state only AFTER a network round-trip resolves — e.g. an
 * enqueue POST whose 202 gates the UI (the ✦ batch header `startBatch` and the journey
 * start CTA both dispatch their state transition *after* the await, so the button stays
 * clickable for the whole request window). Without a guard the second click launches a
 * duplicate whole-snapshot LLM batch / journey run.
 *
 * The flag is a **ref, not state**, so the guard is synchronous within a single tick:
 * the second click of a double-click sees the flag already set before React re-renders.
 * The flag is always cleared in a `finally`, so a settled trigger (error → retry) can
 * start again.
 *
 * Intentionally a single boolean (one logical submission per trigger), so it is NOT for
 * fan-out handlers that must run concurrently per key (e.g. per-cell `generateOne`,
 * which is already guarded structurally by flipping its own cell to loading before the
 * await).
 */
export function useInFlightGuard(): (task: () => Promise<void>) => Promise<void> {
  const inFlight = useRef(false);
  return useCallback(async (task: () => Promise<void>): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await task();
    } finally {
      inFlight.current = false;
    }
  }, []);
}
