// grounded in Design §18.3; pending extension type.ts reconciliation at T13.6
//
// AI 線 · extension · googleAiMode · v1.
// Design §18.3：AI Mode ＝ `blocks + references + reconstructed_markdown`；此外 extension 頁面尚帶 per-channel 專屬區塊
// （如 follow-up「其他人也搜尋」`relatedQuestions`）——骨架白名單暫未涵蓋（per-channel 實欄位屬 M14 T14.4）。
// 初始假設：骨架應能完整收斂本渠道 → full-map。（RED：由 contract test 對現行骨架驗證後對帳。）
import type { MapperGolden } from './golden.types';

export const aiGoogleAiModeV1Golden: MapperGolden = {
  id: 'extension|googleAiMode|v1',
  coverage: 'full-map',
  fixtureVersion: 1,
  input: {
    source: 'extension',
    channel: 'googleAiMode',
    schemaVersion: 'v1',
    capturedAt: '2025-11-21T00:00:00.000Z',
    payload: {
      query: 'is intermittent fasting effective for weight loss',
      blocks: [
        'Intermittent fasting can support weight loss primarily via reduced calorie intake.',
        'Evidence is mixed on advantages beyond overall caloric restriction.',
      ],
      reconstructed_markdown:
        '## Intermittent fasting\n\nIF can support weight loss primarily via reduced calorie intake.',
      references: [
        {
          title: 'NIH Intermittent Fasting Study',
          link: 'https://nih.gov/if',
          snippet: 'A 2024 randomized trial compared 16:8 fasting with standard dieting.',
        },
      ],
      relatedQuestions: ['Does IF slow metabolism?', 'What is the best IF schedule?'],
    },
  },
  expected: {
    mapStatus: 'ok',
    reasons: [],
    canonical: {
      source: 'extension',
      channel: 'googleAiMode',
      schemaVersion: 'v1',
      query: 'is intermittent fasting effective for weight loss',
      // 骨架 alias 先取 `blocks`（`reconstructed_markdown` 為 recognized 別名、不判 unknown，但被 blocks 覆蓋、canonical 不重出）。
      blocks: [
        'Intermittent fasting can support weight loss primarily via reduced calorie intake.',
        'Evidence is mixed on advantages beyond overall caloric restriction.',
      ],
      references: [
        {
          title: 'NIH Intermittent Fasting Study',
          link: 'https://nih.gov/if',
          snippet: 'A 2024 randomized trial compared 16:8 fasting with standard dieting.',
          index: 0,
        },
      ],
      capturedAt: '2025-11-21T00:00:00.000Z',
    },
  },
};
