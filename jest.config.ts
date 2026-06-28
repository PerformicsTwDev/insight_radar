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
};

// core（correctness-critical）門檻：純函式目錄要求 ≥90%（glob 對齊 DevelopmentRules §10.4）。
// 這些目錄隨里程碑陸續建立（M1 mapping、M2 intent、M5 keywords、M8 embeddings…）。
const coreThreshold = { branches: 90, functions: 90, lines: 90, statements: 90 };
const coreThresholds: Record<string, typeof coreThreshold> = {
  './src/**/mapping/**': coreThreshold, // micros/competition/MonthOfYear（TC-3/4/5）
  './src/**/normalize*.ts': coreThreshold, // normalizedText/dedupe（TC-1/6）
  './src/keywords/**': coreThreshold, // FilterSpec/buildPredicate/views/chart 引擎/buildTrend（TC-9/36/37）
  './src/**/intent/**': coreThreshold, // intent 後處理（TC-7）
  './src/embeddings/**': coreThreshold, // buildEmbeddingInput/L2 normalize（TC-39/40）
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
      // integration project（Testcontainers Postgres，`test/integration/**/*.int-spec.ts`
      // + setup-testcontainers globalSetup）於 **T0.9** 補上。
      ...projectBase,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
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
