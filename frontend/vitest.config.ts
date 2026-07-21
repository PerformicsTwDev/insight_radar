import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest config kept separate from vite.config.ts so the app build stays lean.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Vitest owns unit/component tests under `src/` ONLY. Playwright owns `e2e/`
    // (its own `test`/`expect` API); without this scope Vitest would try to run
    // the `e2e/**/*.spec.ts` Playwright specs and crash (T0.3).
    // `scripts/**/*.test.mjs` is included so node build-tooling (the openapi
    // version-lock drift gate, T6.5/TC-38) is unit-tested under the same gate;
    // scripts stay out of the coverage `include` below (src only), so they are
    // coverage-neutral.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.{test,spec}.mjs'],
    coverage: {
      provider: 'v8',
      // `json-summary` → coverage/coverage-summary.json，供 frontend.yml 的 coverage ratchet（對 main 基準）。
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      // `all: true` → 未被任何測試觸及的 src 檔亦計入（記 0%），使覆蓋率 gate 能逼出「新增碼未測」。
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx', // app bootstrap 接線（由 e2e 驗，非單元）
        'src/test/**', // 測試 setup
        'src/**/*.test.{ts,tsx}', // 測試檔本身
        'src/**/*.d.ts',
        // 未來（M1+）：route tree（TanStack Router 產生檔）、純容器薄層 *.tsx（由 component/e2e 驗）。
      ],
      thresholds: {
        // global 85。
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
        // core（`src/lib/**` 純函式）≥90 per-glob gate（Design §13.4）。T1.1 起 `src/lib/**`
        // 已有 `intentMap.ts` + `urlState.ts` 匹配（vitest 對「零匹配 glob」會報錯，故此前只設 global）。
        // `src/api/serialization/**` 暫不加（尚無檔案，零匹配會報錯）——待 T2.5 首個序列化檔落地再補。
        'src/lib/**': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
      },
    },
  },
});
