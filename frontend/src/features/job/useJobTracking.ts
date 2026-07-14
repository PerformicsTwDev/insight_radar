import { initialJobState, type JobState } from '../../lib/jobState';

/** Minimal structural view of the browser `EventSource` the hook depends on (DI seam for tests). */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
  onopen: ((this: unknown, ev: Event) => unknown) | null;
  onerror: ((this: unknown, ev: Event) => unknown) | null;
}

/** Opens an SSE connection for `url`, or `null` when `EventSource` is unavailable (→ poll). */
export type EventSourceFactory = (url: string) => EventSourceLike | null;

/** What `useJobTracking` exposes to the presentational layer. */
export interface JobTracking {
  readonly state: JobState;
  readonly cancel: () => Promise<void>;
}

/** Pure SSE stream URL builder (`apiBaseUrl` empty → same-origin). */
export function buildStreamUrl(_analysisId: string, _apiBaseUrl: string, _origin: string): string {
  return '';
}

/** Default factory: real `EventSource` (with credentials) when the platform has one, else `null`. */
export const defaultEventSourceFactory: EventSourceFactory = () => null;

export function useJobTracking(
  _analysisId: string | undefined,
  _options?: { eventSourceFactory?: EventSourceFactory },
): JobTracking {
  return { state: initialJobState(), cancel: async () => undefined };
}
