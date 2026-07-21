// Extends Vitest's `expect` with @testing-library/jest-dom matchers
// (toBeInTheDocument, etc.) and registers automatic DOM cleanup.
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest';
import { toHaveNoViolations } from 'vitest-axe/matchers';
import { server } from '../api/msw/server';

// a11y gate (NFR-7 / TC-24): register the vitest-axe `toHaveNoViolations` matcher
// globally. vitest-axe's `extend-expect` entry ships empty, so we wire it by hand.
// The shared, WCAG-scoped runner lives in `./axe` (`import { axe } from '../test/axe'`).
expect.extend({ toHaveNoViolations });

// jsdom 未實作 window.scrollTo——TanStack Router 導航後的 scroll restoration 會在測試 stderr 噴
// "Not implemented" 噪音（不影響斷言）。stub 掉保持測試輸出乾淨。
vi.stubGlobal('scrollTo', vi.fn());

// jsdom 無 EventSource（T1.3 job-tracking 用之）。掛一個「惰性」樁：能被 `new` 且實作介面、
// 但永不 emit——讓「順帶掛載」的元件（如首頁 JobTrackingPanel）不致 crash、停在 queued 態、
// 不打網路。真正要驅動 SSE 的測試（TC-35）以注入式 fake EventSource 控制，繞過此樁。
class InertEventSource {
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {}
}
vi.stubGlobal('EventSource', InertEventSource);

// MSW：所有 Vitest 測試共用同一 node server。未註冊的請求 → `error`（強制測試明確 mock，
// 絕不打真後端；契約由型別化 handlers 守，Design §2）。per-test 覆寫用 `server.use(...)`。
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
