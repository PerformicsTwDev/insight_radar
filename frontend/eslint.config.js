// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Design §2 禁用套件清單 → no-restricted-imports (M0 即設).
 * Each entry carries the sanctioned alternative so the failure is self-explanatory.
 */
const restrictedImports = {
  paths: [
    {
      name: 'axios',
      message: 'Use the generated openapi-fetch client (typed, contract-bound) — not axios.',
    },
    { name: 'moment', message: 'Use Intl / date-fns (tree-shakable, immutable) — not moment.' },
    { name: 'redux', message: 'Use Zustand + TanStack Query — not redux.' },
    { name: '@reduxjs/toolkit', message: 'Use Zustand + TanStack Query — not @reduxjs/toolkit.' },
    { name: 'styled-components', message: 'Runtime CSS-in-JS is banned — use Tailwind instead.' },
    {
      name: 'react-router',
      message: 'Use TanStack Router (unified search-params state) — not react-router.',
    },
    {
      name: 'react-router-dom',
      message: 'Use TanStack Router (unified search-params state) — not react-router-dom.',
    },
    {
      name: 'lodash',
      message: 'Import named utilities from lodash-es — never the whole lodash package.',
    },
  ],
  patterns: [
    { group: ['@emotion/*'], message: 'Runtime CSS-in-JS is banned — use Tailwind instead.' },
    {
      group: ['lodash/*'],
      message: 'Import named utilities from lodash-es — not lodash/* submodules.',
    },
  ],
};

export default tseslint.config(
  // Global ignores: build artifacts, coverage, deps, and the (JS) config file itself
  // (no tsconfig project → would break the type-aware parser).
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'eslint.config.js',
      'scripts/**',
      'src/api/schema.d.ts', // openapi-typescript 產物（勿 lint；drift 由 openapi:check 守）
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        // Resolve each file to its owning tsconfig (app/node) for type-aware rules.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // §10.2 硬化基準 (do not relax) + Design §2 禁用清單.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // §10.2：unused error，但容許 `_`-prefixed red-stub 佔位參數/變數（TDD red 空殼慣例）。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-restricted-imports': ['error', restrictedImports],
      // 單一出口不變式（Design §2/§3「M0 即設」）：業務碼禁繞過 typed `api/` client 直接 `fetch`，
      // 禁繞過 fail-fast config 直接讀 `import.meta.env`。（`api/client.ts` 用 `globalThis.fetch`——
      // MemberExpression callee、非 bare，不受此擋；`config/env.ts` 為 env 唯一授權讀點，下方 override 放行。）
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            '禁 bare fetch——業務碼經 typed `api/` client（src/api/client.ts）打後端（single-egress，Design §2/§3）。',
        },
        {
          selector: "MemberExpression[object.type='MetaProperty'][property.name='env']",
          message:
            '禁直接讀 import.meta.env——經 `src/config/env.ts`（fail-fast 驗證後的 `config`）取設定。',
        },
      ],
    },
  },
  // `config/env.ts` = import.meta.env 的唯一授權讀點（fail-fast schema 入口）。
  {
    files: ['src/config/env.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  // C1 守門（Design §6）：趨勢門檻只准來自 config，禁在 `lib/trend` 內聯 magic number
  // （防未來把 5/20 寫死回來）。允許：0（回落 sign 邊界）、1（`length-1`）、100（% 換算）。
  {
    files: ['src/lib/trend.ts'],
    rules: {
      '@typescript-eslint/no-magic-numbers': [
        'error',
        { ignore: [0, 1, 100], ignoreArrayIndexes: true, ignoreEnums: true },
      ],
    },
  },
  // Disable ESLint stylistic rules that conflict with Prettier (Prettier owns formatting).
  prettier,
);
