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
    },
  },
  // Disable ESLint stylistic rules that conflict with Prettier (Prettier owns formatting).
  prettier,
);
