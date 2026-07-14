// Extends Vitest's `expect` with @testing-library/jest-dom matchers
// (toBeInTheDocument, etc.) and registers automatic DOM cleanup.
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from '../api/msw/server';

// jsdom 未實作 window.scrollTo——TanStack Router 導航後的 scroll restoration 會在測試 stderr 噴
// "Not implemented" 噪音（不影響斷言）。stub 掉保持測試輸出乾淨。
vi.stubGlobal('scrollTo', vi.fn());

// MSW：所有 Vitest 測試共用同一 node server。未註冊的請求 → `error`（強制測試明確 mock，
// 絕不打真後端；契約由型別化 handlers 守，Design §2）。per-test 覆寫用 `server.use(...)`。
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
