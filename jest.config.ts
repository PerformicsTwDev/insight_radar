import { globSync } from 'node:fs';
import type { Config } from 'jest';

// ★ 必須 per-project 宣告：在 `projects` 模式下，放在「根層」的 collectCoverageFrom 會被忽略，
//   且若不設此項，覆蓋率只統計「被測試 import 到的檔案」——新增但沒人寫測試的 core 檔
//   （如新的 mapping/foo.ts）不會進報告，global 85% / core 90% 會「假綠」通過（hollow gate）。
const collectCoverageFrom = [
  '<rootDir>/src/**/*.ts',
  '!<rootDir>/src/**/*.module.ts',
  '!<rootDir>/src/**/*.dto.ts',
  '!<rootDir>/src/main.ts',
];

// 各 project 共用的 ts-jest 設定。moduleNameMapper 對齊 tsconfig 的 `src/*` path alias。
// 顯式標註型別，讓 ['ts-jest', {...}] 被視為 TransformerConfig tuple（而非被放寬成陣列）。
const transform: Config['transform'] = {
  '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
};
const projectBase = {
  testEnvironment: 'node' as const,
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: { '^src/(.*)$': '<rootDir>/src/$1' },
  transform,
  // ★ 必須 per-project：在 projects 模式下，放在根層的 coveragePathIgnorePatterns 不會套到各 project，
  //   被測試「執行到」的 *.module.ts / main.ts / *.dto.ts 仍會混進覆蓋率（collectCoverageFrom 的負向
  //   glob 只控「未執行檔是否補 0」，擋不掉已執行檔）。在此排除，與 collectCoverageFrom 一致。
  coveragePathIgnorePatterns: ['/node_modules/', '\\.module\\.ts$', 'main\\.ts$', '\\.dto\\.ts$'],
};

// core（correctness-critical）門檻：純函式目錄要求 ≥90%（glob 對齊 DevelopmentRules §10.4）。
// 這些目錄隨里程碑陸續建立（M1 mapping、M2 intent、M5 keywords、M8 embeddings…）。
const coreThreshold = { branches: 90, functions: 90, lines: 90, statements: 90 };
const coreThresholds: Record<string, typeof coreThreshold> = {
  './src/**/mapping/**': coreThreshold, // micros/competition/MonthOfYear（TC-3/4/5）
  './src/**/normalize*.ts': coreThreshold, // normalizedText/dedupe（TC-1/6）
  // keywords core = **純邏輯**（FilterSpec/buildPredicate、排序分頁、buildTrend、chart 引擎、view builders、
  // view-router 白名單，TC-9/36/37）。`snapshot-query.service`（DB loadSnapshot + 委派）為 DI/DB adapter，
  // 走 global 85%——與 IntentCache/MetricsCache adapter 一致（不把 @Inject 參數 emitDecoratorMetadata 產生的
  // 不可測 undefined-guard 分支當 core 門檻）。
  './src/keywords/filter-spec.ts': coreThreshold,
  './src/keywords/paginate.ts': coreThreshold,
  './src/keywords/build-trend.ts': coreThreshold,
  './src/keywords/aggregate.ts': coreThreshold,
  './src/keywords/query-view.service.ts': coreThreshold,
  './src/keywords/views/**': coreThreshold,
  // core = intent **邏輯**（後處理 TC-7 + 韌性/length 拆批 T2.5 + cache-first 編排 T4.2）。純基礎設施
  // adapter（IntentCache / AzureOpenAi client）走 global 85%——與 google-ads 的 MetricsCache adapter 一致；
  // 不把 @Injectable + class-typed 參數 emitDecoratorMetadata 產生的不可測 undefined-guard 分支當 core 門檻。
  './src/**/intent-postprocess*.ts': coreThreshold, // intent 後處理（TC-7）
  './src/**/intent.service.ts': coreThreshold, // 韌性/length 拆批（T2.5）+ cache-first 編排（T4.2）
  // embeddings core = **邏輯**：輸入組裝（TC-39）、L2 normalize、Gemini adapter 的 batch/backoff/normalize/
  // dim-guard（TC-40）。`embedding.repository`（raw-SQL DB adapter）、`embeddings.module`/`gemini-embed.factory`
  // （DI wiring/factory）走 global 85%——與 snapshot-query / IntentCache / MetricsCache adapter 一致（不把
  // @Injectable + class-typed 參數 emitDecoratorMetadata 的不可測 undefined-guard 分支當 core 門檻）。
  './src/embeddings/build-embedding-input.ts': coreThreshold,
  './src/embeddings/l2-normalize.ts': coreThreshold,
  './src/embeddings/gemini-embedding.service.ts': coreThreshold,
  // topics core = **純邏輯**：代表字萃取（TC-43）+ 群命名後處理（TC-44 對齊/清洗/fallback）。
  // service/module 等 DI adapter 另走 global 85%。
  './src/topics/representatives.ts': coreThreshold,
  './src/topics/topic-naming.postprocess.ts': coreThreshold,
  './src/topics/assemble-assignments.ts': coreThreshold,
  './src/topics/topic-idempotency.ts': coreThreshold,
  './src/topics/decide-run-status.ts': coreThreshold,
  './src/topics/build-topics-response.ts': coreThreshold,
};
// Jest 對「coverageThreshold glob 無對應檔案」會直接報錯；故只在該 glob 已有 .ts 檔時才啟用，
// 讓門檻集中定義於此、並在對應 core 目錄一建立就「自動生效」（毋需事後回頭補設定）。
const activeCoreThresholds = Object.fromEntries(
  Object.entries(coreThresholds).filter(([key]) => {
    const rel = key.replace(/^\.\//, '');
    const fileGlob = rel.endsWith('.ts') ? rel : `${rel}/*.ts`;
    return globSync(fileGlob, { cwd: __dirname }).length > 0;
  }),
);

const config: Config = {
  projects: [
    {
      ...projectBase,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      collectCoverageFrom,
    },
    {
      // e2e：Supertest 啟動完整 Nest app（in-process，無 DB）。
      ...projectBase,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
      collectCoverageFrom,
    },
    {
      // integration：Testcontainers Postgres（真實 DB，非 SQLite）；以 --runInBand 跑（test:integration / CI）。
      ...projectBase,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
      globalSetup: '<rootDir>/test/setup-testcontainers.ts',
      globalTeardown: '<rootDir>/test/teardown-testcontainers.ts',
      collectCoverageFrom,
    },
  ],
  collectCoverage: true,
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  coveragePathIgnorePatterns: ['/node_modules/', '\\.module\\.ts$', 'main\\.ts$', '\\.dto\\.ts$'],
  // global 85% 自 M0 即生效；core 90% 門檻見上方 coreThresholds（對應目錄一建立即自動啟用）。
  coverageThreshold: {
    global: { branches: 85, functions: 85, lines: 85, statements: 85 },
    ...activeCoreThresholds,
  },
  // ⚠ `forceExit` 與 `detectOpenHandles` 不可同時長開：forceExit 會在 Jest 收尾前強制退出，
  //   使 detectOpenHandles 的洩漏報告失去意義。CI 平時用下方設定；要抓洩漏時暫時 `forceExit:false`。
  forceExit: true, // 防 Jest hang（搭配 afterAll 關連線）；除錯洩漏時改 false
  detectOpenHandles: false, // 預設關；定位未關閉 handle 時暫開、且同時關掉 forceExit
};
export default config;
