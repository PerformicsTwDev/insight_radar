// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  {
    // 只 lint 應用程式碼（src/test）。根層工具設定檔（type-aware parser 無對應 tsconfig project）
    // 與尚未掛進 src 的 config/ 常數先排除；T0.2 接手 test 設定、T0.4 把 config/ 併入 src 後再納入。
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'eslint.config.mjs',
      'jest.config.ts',
      'commitlint.config.js',
      'config/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // 易踩雷防呆（GUIDES §3.3 / DevelopmentRules §10.7）：擋掉已知不相容套件
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@nestjs/bull', message: '本案用 @nestjs/bullmq（非舊版 @nestjs/bull）。' },
            {
              name: 'cache-manager-redis-store',
              message: '本案用 cache-manager v6 + @keyv/redis（非舊 redis-store）。',
            },
            {
              name: 'cache-manager-ioredis',
              message: '本案用 cache-manager v6 + @keyv/redis（非 ioredis store）。',
            },
          ],
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
