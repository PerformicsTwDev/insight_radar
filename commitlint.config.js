/** @type {import('@commitlint/types').UserConfig} */
// scope-enum 強制對映 DevelopmentRules §7.2 的模組 scope；與 pr-title.yml、area: label 同源。
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'test',
        'refactor',
        'perf',
        'docs',
        'chore',
        'build',
        'ci',
        'style',
        'revert',
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'googleAds',
        'intent',
        'keyword-analysis',
        'keywords',
        'embeddings',
        'clustering',
        'topics',
        'journey', // 購買歷程分類（journey/，FR-33/M12）
        'custom-classify', // 自訂分類 HITL（custom-classify/，FR-34/M12）
        'ideation', // AI 輔助發想（ideation/，FR-35/M12）
        'serp',
        'cache',
        'config',
        'common',
        'health',
        'queue',
        'db',
        'deps',
        'deps-dev', // Dependabot dev 相依（prefix-development + include: scope 產生）
        'release',
        'frontend', // 前端子專案（frontend/，spec: docs/_p/spec/frontend/）
      ],
    ],
    'scope-empty': [0], // 允許跨模組改動不帶 scope
    'subject-case': [0], // 放寬（容許技術名詞大小寫）
    'header-max-length': [2, 'always', 72],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
  },
};
