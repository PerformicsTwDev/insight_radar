// grounded in Design §18.3; pending extension type.ts reconciliation at T13.6
//
// AI 線 · extension · googleAiMode · v1 — SKELETON-PARTIAL（pending T14.4 whitelist 擴充）。
// Design §18.3：AI Mode ＝ `blocks + references + reconstructed_markdown`；此外 extension 頁面尚帶 per-channel 專屬區塊
// （如 follow-up「其他人也搜尋」`relatedQuestions`）——骨架白名單暫未涵蓋 → `unknown_field:relatedQuestions` →
// `mapStatus=partial`（AC-37.4 漂移預警，**非 bug**）。core（query/blocks/references）仍完整收斂。per-channel 實欄位收斂屬
// M14 T14.4，屆時本 golden 應由 partial→ok（contract test 會因此轉紅，逼出一次有意識的 fixture 對帳）。
import type { MapperGolden } from './golden.types';

export const aiGoogleAiModeV1Golden: MapperGolden = {
  id: 'extension|googleAiMode|v1',
  coverage: 'skeleton-partial',
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
    mapStatus: 'partial',
    reasons: ['unknown_field:relatedQuestions'],
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
