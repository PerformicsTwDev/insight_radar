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
  // ★ __fixtures__：**測試 golden 資料**（如 T13.5 capture mapper goldens），非可出貨 production source——
  //   靜態資料/re-export、無分支邏輯可守；比照 *.spec.ts 排除於覆蓋率分母外（否則落入 `./src/**/mapping/**`
  //   core 90% per-file 門檻會對純資料檔誤判 functions/branches 不足）。對外行為由 contract test 把關。
  '!<rootDir>/src/**/__fixtures__/**',
  // ★ auth.controller：**純路由 shell**，比照 *.module.ts 排除（見下方 coveragePathIgnorePatterns 註記）。
  '!<rootDir>/src/auth/auth.controller.ts',
  // ★ tracking-list.controller（T11.2）：同屬**純路由 shell**——5 個 handler 皆直線委派
  //   `this.service.X(...)`，owner-scope / P2002→409 / 404 等真實分支全在 gate 內的
  //   `TrackingListService`（100% 覆蓋）；剩餘缺口 100% 屬 emitDecoratorMetadata phantom
  //   branch，比照 auth.controller 排除，對外行為由 TC-64 e2e 把關（coverage-gate rule §4）。
  '!<rootDir>/src/tracking/tracking-list.controller.ts',
  // ★ tracking-refresh.service（T11.6）：**純入列 shell**——`enqueueManualRefresh` 無真實分支
  //   （owner-scope 唯一真實分支在 gate 內 `assertOwnedRow`，由 owner-scope.spec 單測；`manualRefreshJobId`
  //   為無分支純字串）。剩餘缺口 100% 屬 `@InjectQueue`/class-typed 建構子 + `Promise` 回傳的
  //   emitDecoratorMetadata phantom branch，比照 auth.controller/tracking-list.controller 排除；對外行為
  //   由 tracking-refresh.service.spec（入列/owner-404）+ TC-65 refresh e2e（202/404）把關（coverage-gate §4）。
  //   註：processor **不**排除——其 manual-vs-scheduled 解析 + partial 迴圈為真實分支、留在 gate 內。
  '!<rootDir>/src/tracking/tracking-refresh.service.ts',
  // ★ ai-insight.controller（T12.4）：**純委派 shell**——單一 handler 直委派 `service.generate`；ParseUUIDPipe
  //   （400）、unknown-view/readiness/owner（400/409/404）、LLM 失敗→502（filter）等真實分支全在 gate 內的
  //   `AiInsightService`/`SnapshotQueryService`/`AiInsightGenerationFilter`；剩餘缺口 100% 屬 emitDecoratorMetadata
  //   phantom branch，比照 auth.controller/tracking-list.controller 排除，對外行為由 ai-insight.e2e 把關（§4）。
  '!<rootDir>/src/ai-insight/ai-insight.controller.ts',
  // ★ journey.controller（T12.6）：**純委派 shell**——`create`/`getStatus` 直委派 `JourneyRunService`；SSE `stream`
  //   的映射分支（isTerminalEvent / toMessageEvent / terminalSnapshot / takeWhile-inclusive）已由 journey.controller.spec
  //   全覆蓋（9 例，含 live progress/completed/failed、terminal completed/partial/failed、empty、degrade）；owner/readiness/
  //   413 等真實分支全在 gate 內的 `JourneyRunService`。lcov 驗剩餘缺口 100% 屬 emitDecoratorMetadata phantom
  //   （建構子 class-typed 參數 + `Promise<Observable>` 回傳型別，L54/65/74/87）；比照 ai-insight.controller 排除，
  //   對外行為由 journey e2e（POST/GET/SSE 202/425/409/404/413/401）把關（coverage-gate rule §4）。
  '!<rootDir>/src/journey/journey.controller.ts',
  // ★ custom-classify.controller（T12.7）：**純委派 shell**——單一 handler `create` 直委派
  //   `CustomClassifyService.generateLabels`；ParseUUIDPipe/ValidationPipe 為框架層、owner-404/readiness-409
  //   /LLM-502 等真實分支全在 gate 內（`SnapshotQueryService` / `CustomClassifyService` / `CustomClassifyGenerationFilter`
  //   皆有單元 spec）。移除後剩餘缺口 100% 屬 emitDecoratorMetadata phantom branch（class-typed 建構子 + DTO 參數
  //   + Promise 回傳），比照 ai-insight.controller 排除，對外行為由 custom-classify.e2e 把關（coverage-gate rule §4）。
  '!<rootDir>/src/custom-classify/custom-classify.controller.ts',
  // ★ custom-classify-assign.controller（T12.8）：**純委派 SSE shell**——`create`/`getStatus` 直委派
  //   `CustomClassifyRunService`；SSE `stream` 的映射分支（isTerminalEvent / toMessageEvent / terminalSnapshot /
  //   takeWhile-inclusive）已由 custom-classify-assign.controller.spec 全覆蓋；owner/404/409/413 真實分支全在 gate
  //   內的 `CustomClassifyRunService`。剩餘缺口 100% 屬 emitDecoratorMetadata phantom（同 journey.controller），
  //   比照排除，對外行為由 custom-classify-assign.e2e 把關（coverage-gate rule §4）。
  '!<rootDir>/src/custom-classify/custom-classify-assign.controller.ts',
  // ★ ideation.controller（T12.10）：**純委派 shell**——單一 handler `generate` 直委派 `IdeationService.generate`；
  //   驗證（未知 template `@IsIn`→400 / 空 seeds→400）由 ValidationPipe、LLM 失敗→502 由 `IdeationGenerationFilter`
  //   （皆 gate 內受測）。剩餘缺口 100% 屬 emitDecoratorMetadata phantom，比照 ai-insight.controller 排除，對外行為
  //   由 ideation.e2e 把關（coverage-gate rule §4）。
  '!<rootDir>/src/ideation/ideation.controller.ts',
  // ★ captures.controller（T13.2）：**純委派 shell**——單一 handler `ingest` 直委派 `CapturesService.ingest`；
  //   批次上限（413）/ownerId 歸屬/raw 落庫等真實分支全在 gate 內的 `CapturesService`（100% 覆蓋 + service e2e），
  //   DTO 驗證（未知 source/缺 schemaVersion/空 items→400）由 ValidationPipe、body 上限→413 由 scopedJsonBodyLimit
  //   （皆 gate 內受測）。剩餘缺口 100% 屬 emitDecoratorMetadata phantom（class-typed 建構子 + DTO 參數 + Promise
  //   回傳），比照 ai-insight.controller 排除，對外行為由 captures.e2e 把關（coverage-gate rule §4）。
  '!<rootDir>/src/captures/captures.controller.ts',
  // 純委派 shell（T14.5，owner-scope/404/409 分支全在 gate 內 BrandProfileService；剩餘缺口＝
  // emitDecoratorMetadata phantom，對外行為由 brand-profile-crud.e2e 把關，coverage-gate rule §4）。
  '!<rootDir>/src/brand-profile/brand-profile.controller.ts',
  // ★ ai-search.controller（T14.6）：**純委派 SSE shell**（同 custom-classify-assign.controller）——`create`/`getStatus`
  //   直委派 `AiSearchRunService`；SSE `stream` 的映射分支（isTerminalEvent / toMessageEvent / terminalSnapshot /
  //   takeWhile-inclusive / fetchRef 降級）已由 ai-search.controller.spec 全覆蓋；enqueue-only/owner-404 真實分支全在
  //   gate 內的 `AiSearchRunService`（unit + e2e）。剩餘缺口 100% 屬 emitDecoratorMetadata phantom（class-typed 建構子
  //   + DTO/param 參數 + Promise 回傳），比照排除，對外行為由 ai-search.e2e 把關（coverage-gate rule §4）。
  '!<rootDir>/src/ai-search/ai-search.controller.ts',
];

// 覆蓋率排除清單（與 collectCoverageFrom 的負向 glob 一致；per-project + 根層兩處都要設，見下方註記）。
// 一般 controller **不排除**（有真實分支邏輯、留在 gate 內，coverage-gate rule §4）；此處唯一例外＝
// `auth.controller.ts`：它是**純路由 shell**——4 個 handler 皆直線委派，session 認證的唯一真實分支已下放至
// `SessionService.authenticate`（gate 內、由 session.service.spec 直接單元測試）。移除該分支後，本檔剩餘的
// 覆蓋率缺口 100% 屬 `emitDecoratorMetadata`（isolatedModules + ES2023）對 class-typed 建構子/DTO 參數與
// `Promise` 回傳型別生成的 `typeof X==='function'?X:Object` **不可測 phantom branch**（cookie 讀寫需 4 個
// handler 各帶 @Body/@Req/@Res + Promise 回傳 → phantom 密度特高、無真實分支稀釋 → 78% branch）。因此本檔
// 與 *.module.ts/*.dto.ts/main.ts 同類（無真實分支邏輯、僅餘 decorator-metadata 假 branch），比照排除；
// 其對外行為由 TC-59 e2e（register/login/logout/me + 401 邊界）完整把關。
const coverageIgnore = [
  '/node_modules/',
  '/__fixtures__/', // 測試 golden 資料（T13.5），非 production source——比照 *.spec.ts 排除（見 collectCoverageFrom 註記）
  '\\.module\\.ts$',
  'main\\.ts$',
  '\\.dto\\.ts$',
  'auth/auth\\.controller\\.ts$',
  'tracking/tracking-list\\.controller\\.ts$', // 純路由 shell（T11.2，同 auth.controller）
  'tracking/tracking-refresh\\.service\\.ts$', // 純入列 shell（T11.6，owner-scope 分支在 gate 內 assertOwnedRow）
  'ai-insight/ai-insight\\.controller\\.ts$', // 純委派 shell（T12.4，狀態分支在 gate 內 service/filter）
  'journey/journey\\.controller\\.ts$', // 純委派 shell（T12.6，SSE 分支全測、owner/413 分支在 gate 內 JourneyRunService）
  'custom-classify/custom-classify\\.controller\\.ts$', // 純委派 shell（T12.7，owner/readiness/502 分支在 gate 內 service/filter）
  'custom-classify/custom-classify-assign\\.controller\\.ts$', // 純委派 SSE shell（T12.8，SSE 分支全測、owner/404/409/413 在 gate 內 run-service）
  'ideation/ideation\\.controller\\.ts$', // 純委派 shell（T12.10，驗證/502 分支在 gate 內 ValidationPipe/filter）
  'captures/captures\\.controller\\.ts$', // 純委派 shell（T13.2，批次/ownerId/落庫分支在 gate 內 CapturesService）
  'brand-profile/brand-profile\\.controller\\.ts$', // 純委派 shell（T14.5，owner/404/409 分支在 gate 內 BrandProfileService）
  'ai-search/ai-search\\.controller\\.ts$', // 純委派 SSE shell（T14.6，SSE 分支全測、enqueue-only/owner-404 在 gate 內 AiSearchRunService）
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
  coveragePathIgnorePatterns: coverageIgnore,
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
  // embeddings core = **純邏輯**：輸入組裝（TC-39）、L2 normalize、Gemini adapter 的 batch/backoff/normalize/
  // dim-guard（TC-40）、cache-first 命中/未命中切分 + 回填對齊（TC-50；off-by-one 即 embedding↔keyword 全表錯位）。
  // ── M8-R9 分類（file-level，對比 intent 前例）──────────────────────────────────────────────────
  // `embedding.service`（cache-first DI 編排 shell）與 `embedding-cache`（Redis mget/mset adapter）走 global 85%：
  // 其 method-body 分支已 100% 覆蓋，唯一未覆蓋者＝ @Injectable + class-typed 建構子參數經 emitDecoratorMetadata
  // 產生的 `typeof X==='undefined'?Object:X` 不可測 DI-guard cond-expr（各 2 條、僅佔 13/10 條總分支→結構上無法
  // 達 90%）。對比 `intent.service`（core）：它靠 T2.5 韌性/拆批的 28 條真實分支稀釋掉 1 條同類 phantom（96.6%）
  // 而達標；embeddings 的等價 cache-first **真實邏輯**已抽成純函式 `cache-first.ts` 掛 core-90%，故編排/快取 shell
  // 與 IntentCache / MetricsCache / snapshot-query adapter 一致走 global 85%（`embedding.repository` raw-SQL、
  // `embeddings.module`/`gemini-embed.factory` DI wiring 亦同）。註：`embedding.service.ts` 於全 git 史從未列入
  // coreThresholds（無門檻曾被調低；#291「narrowed」前提不成立）。
  './src/embeddings/build-embedding-input.ts': coreThreshold,
  './src/embeddings/l2-normalize.ts': coreThreshold,
  './src/embeddings/gemini-embedding.service.ts': coreThreshold,
  './src/embeddings/cache-first.ts': coreThreshold,
  // topics core = **純邏輯**：代表字萃取（TC-43）+ 群命名後處理（TC-44 對齊/清洗/fallback）。
  // service/module 等 DI adapter 另走 global 85%。
  './src/topics/representatives.ts': coreThreshold,
  './src/topics/topic-naming.postprocess.ts': coreThreshold,
  './src/topics/assemble-assignments.ts': coreThreshold,
  './src/topics/topic-idempotency.ts': coreThreshold,
  './src/topics/decide-run-status.ts': coreThreshold,
  './src/topics/build-topics-response.ts': coreThreshold,
  './src/topics/topic-job-metrics.ts': coreThreshold,
  // tracking core = **純邏輯**：搜量 store-on-change 全欄相等判定 + backfill 月裁切（TC-65、正確性單點 S3）；
  // 時序組裝（T11.7：axis 聯集 + per-member 對齊 + total-with-null-breakpoint + latest，TC-66、S2 null≠0）。
  // `volume-refresh.service`（DI 編排：Prisma + GoogleAdsService + partial try/catch）走 global 85%——
  // 與其他 DI 服務一致（不把 @Injectable class-typed 建構子的 emitDecoratorMetadata phantom branch 當 core）。
  './src/tracking/volume-observation.ts': coreThreshold,
  './src/tracking/volume-series.ts': coreThreshold,
  // brand-profile core = **純函式**：aliases 聯集正規化比對（`華碩→ASUS`，TC-76 / FR-40 / AC-40.3；供 FR-42
  // 品牌抽取共用）。CRUD service（DI 編排：Prisma + owner-scope helper）走 global 85%——與其他 DI 服務一致。
  './src/brand-profile/brand-match.ts': coreThreshold,
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
  coveragePathIgnorePatterns: coverageIgnore,
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
